import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../db';
import { authenticateToken, requirePermission, recordAuditLog } from '../auth';

const router = Router();
router.use(authenticateToken);
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'SEASONAL'];

async function canAccessEmployee(req: Request, userId: string, primaryBranchId: string | null): Promise<boolean> {
  const u = req.user!;
  if (u.isSuperUser || userId === u.id) return true;
  if (primaryBranchId && u.allowedBranchIds.includes(primaryBranchId)) return true;
  if (!u.allowedBranchIds.length) return false;
  const placeholders = u.allowedBranchIds.map(() => '?').join(',');
  const access = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM user_branch_access WHERE user_id = ? AND branch_id IN (${placeholders}) LIMIT 1`,
    [userId, ...u.allowedBranchIds]
  );
  return Boolean(access);
}

router.get('/', requirePermission('employees.view'), async (req: Request, res: Response): Promise<void> => {
  const { branch_id, franchise_id, search, employment_type } = req.query;
  const u = req.user!; const params: any[] = []; let where = 'u.deleted_at IS NULL';
  if (!u.isSuperUser) {
    if (!u.allowedBranchIds.length) { res.json({ employees: [] }); return; }
    const placeholders = u.allowedBranchIds.map(() => '?').join(',');
    where += ` AND (u.branch_id IN (${placeholders}) OR EXISTS (SELECT 1 FROM user_branch_access uba_scope WHERE uba_scope.user_id = u.id AND uba_scope.branch_id IN (${placeholders})))`;
    params.push(...u.allowedBranchIds, ...u.allowedBranchIds);
  }
  if (branch_id && typeof branch_id === 'string') {
    if (!u.isSuperUser && !u.allowedBranchIds.includes(branch_id)) {
      res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', code: 'BRANCH_ACCESS_DENIED', message: 'Requested branch is outside your assigned access scope.', details: { branch_id } });
      return;
    }
    where += ' AND (u.branch_id = ? OR EXISTS (SELECT 1 FROM user_branch_access uba_branch WHERE uba_branch.user_id = u.id AND uba_branch.branch_id = ?))';
    params.push(branch_id, branch_id);
  }
  if (franchise_id && typeof franchise_id === 'string') { where += ' AND b.franchise_id = ?'; params.push(franchise_id); }
  if (employment_type && typeof employment_type === 'string') { where += ' AND ep.employment_type = ?'; params.push(employment_type); }
  if (search && typeof search === 'string') { where += ` AND (LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ? OR u.phone LIKE ? OR LOWER(ep.employee_code) LIKE ? OR LOWER(ep.position_title) LIKE ?)`; const term = `%${search.trim().toLowerCase()}%`; params.push(term, term, term, term, term); }
  const employees = await query<any>(`SELECT u.id,u.full_name,u.email,u.phone,u.avatar_url,u.status,u.employment_status,u.disciplinary_status,u.joined_at,u.branch_id,b.name AS branch_name,b.code AS branch_code,b.franchise_id,f.name AS franchise_name,f.code AS franchise_code,ep.employee_code,ep.position_title,ep.department,ep.employment_type,ep.hire_date,ep.termination_date,ep.notes,ep.created_at AS profile_created_at,ep.updated_at AS profile_updated_at FROM users u LEFT JOIN branches b ON b.id=u.branch_id LEFT JOIN franchises f ON f.id=b.franchise_id INNER JOIN employee_profiles ep ON ep.user_id=u.id WHERE ${where} ORDER BY u.full_name ASC`, params);
  res.json({ employees });
});

router.get('/:id', requirePermission('employees.view'), async (req: Request, res: Response): Promise<void> => {
  const e = await queryOne<any>(`SELECT u.id,u.full_name,u.email,u.phone,u.avatar_url,u.status,u.employment_status,u.disciplinary_status,u.joined_at,u.branch_id,b.name AS branch_name,b.code AS branch_code,b.franchise_id,f.name AS franchise_name,f.code AS franchise_code,ep.employee_code,ep.position_title,ep.department,ep.employment_type,ep.hire_date,ep.termination_date,ep.notes,ep.created_at AS profile_created_at,ep.updated_at AS profile_updated_at FROM users u LEFT JOIN branches b ON b.id=u.branch_id LEFT JOIN franchises f ON f.id=b.franchise_id INNER JOIN employee_profiles ep ON ep.user_id=u.id WHERE u.id=? AND u.deleted_at IS NULL`, [req.params.id]);
  if (!e) { res.status(404).json({ error: 'NOT_FOUND', message: 'Employee profile not found.' }); return; }
  if (!(await canAccessEmployee(req, e.id, e.branch_id))) { res.status(403).json({ error: 'BRANCH_ACCESS_DENIED', message: 'Employee belongs to an unauthorized branch.' }); return; }
  const roles = await query<any>(`SELECT r.id,r.code,r.name FROM roles r INNER JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=? AND r.status='ACTIVE'`, [req.params.id]);
  const access = await query<any>(`SELECT uba.branch_id,b.name,b.code,b.franchise_id,f.name AS franchise_name,f.code AS franchise_code FROM user_branch_access uba INNER JOIN branches b ON b.id=uba.branch_id LEFT JOIN franchises f ON f.id=b.franchise_id WHERE uba.user_id=? ORDER BY b.name`, [req.params.id]);
  const history = await query<any>(`SELECT id,employment_status,disciplinary_status,reason,notes,effective_from,effective_until,changed_by,created_at FROM employee_status_history WHERE user_id=? ORDER BY created_at DESC`, [req.params.id]);
  res.json({ employee: { ...e, roles, branch_access: access, status_history: history } });
});

router.post('/:id/profile', requirePermission('employees.update'), async (req: Request, res: Response): Promise<void> => {
  const id=req.params.id; const user=await queryOne<any>('SELECT id,full_name,branch_id,joined_at,created_at FROM users WHERE id=? AND deleted_at IS NULL',[id]);
  if(!user){res.status(404).json({error:'NOT_FOUND',message:'Employee not found.'});return;}
  if(!(await canAccessEmployee(req,id,user.branch_id))){res.status(403).json({error:'BRANCH_ACCESS_DENIED',message:'Employee belongs to an unauthorized branch.'});return;}
  const {employee_code,position_title,department,employment_type,hire_date,termination_date,notes}=req.body;
  if(!employee_code||!position_title){res.status(400).json({error:'VALIDATION_ERROR',message:'employee_code and position_title are required.'});return;}
  const type=employment_type||'FULL_TIME'; if(!EMPLOYMENT_TYPES.includes(type)){res.status(400).json({error:'VALIDATION_ERROR',message:`Invalid employment_type. Allowed: ${EMPLOYMENT_TYPES.join(', ')}`});return;}
  const code=String(employee_code).trim().toUpperCase(); const conflict=await queryOne<any>('SELECT user_id FROM employee_profiles WHERE employee_code=? AND user_id<>?',[code,id]);
  if(conflict){res.status(409).json({error:'CONFLICT',message:'Employee code is already assigned.'});return;}
  const now=new Date().toISOString(); const existing=await queryOne<any>('SELECT * FROM employee_profiles WHERE user_id=?',[id]);
  if(existing) await execute(`UPDATE employee_profiles SET employee_code=?,position_title=?,department=?,employment_type=?,hire_date=?,termination_date=?,notes=?,updated_at=? WHERE user_id=?`,[code,String(position_title).trim(),department?.trim()||null,type,hire_date??existing.hire_date,termination_date??existing.termination_date,notes??existing.notes,now,id]);
  else await execute(`INSERT INTO employee_profiles (user_id,employee_code,position_title,department,employment_type,hire_date,termination_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,[id,code,String(position_title).trim(),department?.trim()||null,type,hire_date||user.joined_at||user.created_at,null,notes?.trim()||null,now,now]);
  await recordAuditLog({action:existing?'EMPLOYEE_PROFILE_UPDATED':'EMPLOYEE_PROFILE_CREATED',entityType:'EMPLOYEE_PROFILE',entityId:id,branchId:user.branch_id,oldValues:existing||null,newValues:{employee_code:code,position_title,department,employment_type:type,hire_date,termination_date},req});
  const profile=await queryOne<any>('SELECT * FROM employee_profiles WHERE user_id=?',[id]); res.status(existing?200:201).json({profile});
});

export default router;
