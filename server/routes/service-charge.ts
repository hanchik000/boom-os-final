import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, transaction } from '../db';
import { authenticateToken, requirePermission, insertAuditLog } from '../auth';
import { SERVICE_CHARGE_CATEGORIES, SERVICE_CHARGE_MODES, SERVICE_CHARGE_STRATEGIES, resolveEffectiveConfig, distributeServiceChargePools, pctHundredths } from '../service-charge';

const router = Router(); router.use(authenticateToken);
function allowed(req: Request, b: string){ return Boolean(req.user?.isSuperUser || req.user?.allowedBranchIds.includes(b)); }
function percentText(v: unknown){ const s=String(v??'').trim(); return /^\d+(?:\.\d{1,2})?$/.test(s) ? s : null; }
function id(prefix: string){ return `${prefix}_${crypto.randomUUID()}`; }

async function loadConfig(configId: string) {
  const config = await queryOne<any>('SELECT * FROM service_charge_configs WHERE id=?',[configId]);
  if (!config) return null;
  const categories = await query<any>(`SELECT * FROM service_charge_categories WHERE config_id=? ORDER BY category`,[configId]);
  for (const c of categories) {
    c.members = await query<any>(`SELECT a.id,a.user_id,a.percent,a.target_type,u.full_name FROM service_charge_allocations a LEFT JOIN users u ON u.id=a.user_id WHERE a.category_id=? AND a.active=true ORDER BY a.created_at`,[c.id]);
  }
  return { ...config, categories };
}

// The configuration version currently in force for a branch (its own, or the organisation default).
router.get('/:branchId', requirePermission('service_charge.view'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const effective = await resolveEffectiveConfig({query,queryOne}, b, new Date().toISOString());
  res.json({ config: effective ? await loadConfig(effective.id) : null, categories: SERVICE_CHARGE_CATEGORIES, modes: SERVICE_CHARGE_MODES, strategies: SERVICE_CHARGE_STRATEGIES });
});

// Full version history for a branch, newest first -- nothing is ever edited in place.
router.get('/:branchId/history', requirePermission('service_charge.view'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const versions=await query<any>(`SELECT c.*,u.full_name AS created_by_name FROM service_charge_configs c LEFT JOIN users u ON u.id=c.created_by WHERE (c.scope='BRANCH' AND c.branch_id=?) OR c.scope='ORGANIZATION' ORDER BY c.effective_from DESC LIMIT 100`,[b]);
  for (const v of versions) v.categories = await query<any>(`SELECT category,percent,mode,strategy,active FROM service_charge_categories WHERE config_id=? ORDER BY category`,[v.id]);
  res.json({ versions });
});

/**
 * Publishing a configuration NEVER edits the current one: it archives the version in force (giving
 * it an effective_to) and inserts a new ACTIVE version. Orders already priced under the old version
 * keep pointing at it, so nothing historical is ever recalculated.
 *
 * scope=ORGANIZATION publishes the organisation-wide default instead of a branch version; a branch
 * version always wins over it.
 */
router.put('/:branchId', requirePermission('service_charge.manage'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const scope=String(req.body?.scope||'BRANCH').toUpperCase();
  if(!['BRANCH','ORGANIZATION'].includes(scope)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_SERVICE_CHARGE_SCOPE',message:'scope must be BRANCH or ORGANIZATION.',details:{}});
  if(scope==='ORGANIZATION' && !(req.user!.isSuperUser || req.user!.permissions.includes('franchises.manage'))) return res.status(403).json({error:'FORBIDDEN',code:'ORGANIZATION_SCOPE_FORBIDDEN',message:'Publishing the organisation-wide default requires organisation-level rights.',details:{}});

  // Stage 34.2 replaced the flat allocation list with categories. Silently ignoring a legacy
  // payload would leave the caller believing they had configured a distribution they had not, so
  // it is refused explicitly and told what replaced it.
  if(Array.isArray(req.body?.allocations)) return res.status(400).json({error:'VALIDATION_ERROR',code:'ALLOCATIONS_REPLACED_BY_CATEGORIES',message:'The flat allocations list was replaced by categories; send categories[] with category, percent, mode, strategy and members.',details:{categories:SERVICE_CHARGE_CATEGORIES,modes:SERVICE_CHARGE_MODES,strategies:SERVICE_CHARGE_STRATEGIES}});
  const percent=percentText(req.body?.percent);
  const takeaway=percentText(req.body?.takeaway_percent ?? '0');
  const delivery=percentText(req.body?.delivery_percent ?? '0');
  if(percent===null||takeaway===null||delivery===null||[percent,takeaway,delivery].some(p=>Number(p)>100)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_SERVICE_CHARGE_PERCENT',message:'Each service charge percentage must be between 0 and 100.',details:{}});

  const categories=Array.isArray(req.body?.categories)?req.body.categories:[];
  let categorySum=0n;
  for(const c of categories){
    const name=String(c?.category||'').toUpperCase();
    if(!(SERVICE_CHARGE_CATEGORIES as readonly string[]).includes(name)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_SERVICE_CHARGE_CATEGORY',message:`Unknown category: ${name}`,details:{categories:SERVICE_CHARGE_CATEGORIES}});
    const mode=String(c?.mode||'COMMON').toUpperCase();
    if(!(SERVICE_CHARGE_MODES as readonly string[]).includes(mode)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_SERVICE_CHARGE_MODE',message:'mode must be COMMON or INDIVIDUAL.',details:{}});
    const strategy=String(c?.strategy||'EQUAL').toUpperCase();
    if(!(SERVICE_CHARGE_STRATEGIES as readonly string[]).includes(strategy)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_SERVICE_CHARGE_STRATEGY',message:'Unknown distribution strategy.',details:{strategies:SERVICE_CHARGE_STRATEGIES}});
    const cp=percentText(c?.percent); if(cp===null) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_CATEGORY_PERCENT',message:'Each category needs a non-negative percentage.',details:{category:name}});
    categorySum+=pctHundredths(cp);
    const members=Array.isArray(c?.members)?c.members:[];
    let memberSum=0n;
    for(const m of members){
      const mp=percentText(m?.percent ?? '0'); if(mp===null) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_MEMBER_PERCENT',message:'Each member percentage must be non-negative.',details:{category:name}});
      if(!m?.user_id) return res.status(400).json({error:'VALIDATION_ERROR',code:'MEMBER_USER_REQUIRED',message:'Each category member must name an employee.',details:{category:name}});
      if(mode==='INDIVIDUAL') memberSum+=pctHundredths(mp);
    }
    // An individually-allocated category may never hand out more than the category itself holds.
    if(mode==='INDIVIDUAL' && memberSum>pctHundredths(cp)) return res.status(400).json({error:'VALIDATION_ERROR',code:'MEMBER_ALLOCATIONS_EXCEED_CATEGORY',message:'Individual allocations cannot exceed the category percentage.',details:{category:name,category_percent:cp}});
  }
  // The whole point of the rule: allocations can never exceed the service charge that is actually
  // collected. Whatever is left over stays with the establishment.
  if(categorySum>pctHundredths(percent)) return res.status(400).json({error:'VALIDATION_ERROR',code:'ALLOCATIONS_EXCEED_SERVICE_CHARGE',message:'Category total cannot exceed the configured service charge.',details:{service_charge:percent}});

  const now=new Date().toISOString();
  const effectiveFrom=typeof req.body?.effective_from==='string'&&req.body.effective_from.trim()?String(req.body.effective_from).trim():now;
  const configId=id('scc');
  try{
    const result=await transaction(async(tx)=>{
      const previous=await tx.queryOne<any>(`SELECT * FROM service_charge_configs WHERE status='ACTIVE' AND effective_to IS NULL AND ((scope='BRANCH' AND branch_id=?) OR (scope='ORGANIZATION' AND ?='ORGANIZATION')) AND scope=? FOR UPDATE`,[b,scope,scope]);
      if(previous) await tx.execute(`UPDATE service_charge_configs SET status='ARCHIVED',effective_to=?,updated_at=? WHERE id=?`,[effectiveFrom,now,previous.id]);
      await tx.execute(`INSERT INTO service_charge_configs (id,branch_id,scope,percent,takeaway_percent,delivery_percent,status,effective_from,effective_to,note,created_by,created_at,updated_at) VALUES (?,?,?,CAST(? AS numeric),CAST(? AS numeric),CAST(? AS numeric),'ACTIVE',?,NULL,?,?,?,?)`,[configId,scope==='BRANCH'?b:null,scope,percent,takeaway,delivery,effectiveFrom,req.body?.note?String(req.body.note).slice(0,500):null,req.user!.id,now,now]);
      for(const c of categories){
        const name=String(c.category).toUpperCase(), mode=String(c?.mode||'COMMON').toUpperCase(), strategy=String(c?.strategy||'EQUAL').toUpperCase();
        const categoryId=id('scg');
        await tx.execute(`INSERT INTO service_charge_categories (id,config_id,category,percent,mode,strategy,active,created_at,updated_at) VALUES (?,?,?,CAST(? AS numeric),?,?,true,?,?)`,[categoryId,configId,name,String(c.percent),mode,strategy,now,now]);
        for(const m of (Array.isArray(c?.members)?c.members:[])){
          const u=await tx.queryOne<any>('SELECT id,branch_id FROM users WHERE id=? AND deleted_at IS NULL',[String(m.user_id)]);
          if(!u) throw Object.assign(new Error('MEMBER_NOT_FOUND'),{httpStatus:404});
          if(scope==='BRANCH' && !allowed(req,u.branch_id||'')) throw Object.assign(new Error('MEMBER_BRANCH_MISMATCH'),{httpStatus:403});
          await tx.execute(`INSERT INTO service_charge_allocations (id,config_id,category_id,target_type,department,user_id,percent,active,created_at,updated_at) VALUES (?,?,?,?,?,?,CAST(? AS numeric),true,?,?)`,[id('sca'),configId,categoryId,mode==='INDIVIDUAL'?'INDIVIDUAL':'MEMBER',name,String(m.user_id),String(m?.percent??'0'),now,now]);
        }
      }
      await insertAuditLog(tx.execute,{userId:req.user!.id,branchId:b,action:'SERVICE_CHARGE_VERSION_PUBLISHED',entityType:'SERVICE_CHARGE_CONFIG',entityId:configId,oldValues:previous?{config_id:previous.id,percent:String(previous.percent)}:null,newValues:{scope,percent,takeaway_percent:takeaway,delivery_percent:delivery,effective_from:effectiveFrom,categories:categories.map((c:any)=>({category:String(c.category).toUpperCase(),percent:String(c.percent),mode:String(c?.mode||'COMMON').toUpperCase(),strategy:String(c?.strategy||'EQUAL').toUpperCase(),members:(c?.members||[]).length}))},req});
      return configId;
    });
    res.status(201).json({ config: await loadConfig(result) });
  }catch(e:any){
    const map:any={MEMBER_NOT_FOUND:[404,'NOT_FOUND','MEMBER_NOT_FOUND'],MEMBER_BRANCH_MISMATCH:[403,'BRANCH_ACCESS_DENIED','MEMBER_BRANCH_MISMATCH']};
    if(map[e.message]) return res.status(map[e.message][0]).json({error:map[e.message][1],code:map[e.message][2],message:e.message,details:{}});
    throw e;
  }
});

router.get('/:branchId/ledger', requirePermission('service_charge.view'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const rows=await query<any>('SELECT scl.*,u.full_name AS user_name,o.order_number FROM service_charge_ledger scl LEFT JOIN users u ON u.id=scl.user_id LEFT JOIN orders o ON o.id=scl.order_id WHERE scl.branch_id=? ORDER BY scl.created_at DESC LIMIT 500',[b]);
  const totals=await query<any>(`SELECT status,target_type,COALESCE(SUM(amount),0) AS total FROM service_charge_ledger WHERE branch_id=? GROUP BY status,target_type ORDER BY status,target_type`,[b]);
  res.json({ledger:rows, totals});
});

// Distributes the COMMON category pools earned in a period to their members, by each category's
// configured strategy. Pools whose members all weigh zero are reported, never split on a guess.
router.post('/:branchId/distribute', requirePermission('service_charge.manage'), async(req,res)=>{
  const b=req.params.branchId; if(!allowed(req,b)) return res.status(403).json({error:'BRANCH_ACCESS_DENIED',code:'BRANCH_ACCESS_DENIED',message:'Branch is outside your access scope.',details:{}});
  const from=typeof req.body?.from==='string'?req.body.from:null, to=typeof req.body?.to==='string'?req.body.to:null;
  if(!from||!to||Number.isNaN(Date.parse(from))||Number.isNaN(Date.parse(to))||Date.parse(to)<=Date.parse(from)) return res.status(400).json({error:'VALIDATION_ERROR',code:'INVALID_DISTRIBUTION_PERIOD',message:'from and to must be ISO timestamps with to after from.',details:{}});
  const now=new Date().toISOString();
  const result=await transaction(async(tx)=>distributeServiceChargePools(tx,b,from,to,req.user!.id,req,now));
  res.json({branch_id:b, from, to, ...result});
});

export default router;
