import { describe, expect, it, vi } from 'vitest';
import type { RelativeImagePath, Result } from '../../src/contracts';
import { SyncAwareImageStore, SyncEngine } from '../../src/sync/SyncEngine';
import type {
  DurableOutboxMutation, LocalAssetDownloadCandidate, LocalAssetUploadCandidate, LocalBootstrapPage,
  LocalEntitySyncState, LocalPushApplySummary, LocalPushResultApplication, LocalSyncCheckpoint,
  LocalSyncProfile, LocalSyncRepository,
} from '../../src/sync/localState';
import type { CanonicalAsset, PullChangesResponse, PushMutationsResponse, SyncChange } from '../../src/sync/protocol';
import type { SupabaseAssetTransport } from '../../src/sync/transport/SupabaseAssetTransport';
import type { SupabaseSyncTransport } from '../../src/sync/transport/SupabaseSyncTransport';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const MUTATION = '33333333-3333-4333-8333-333333333333';
const ASSET = '44444444-4444-4444-8444-444444444444';
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

function checkpoint(initialSyncState: LocalSyncCheckpoint['initialSyncState'] = 'complete'): LocalSyncCheckpoint {
  return { pullCursor: 0, minimumRetainedSequence: 1, initialSyncState, bootstrapSessionId: null, bootstrapAfterOrdinal: null, bootstrapSnapshotHeadSequence: null, catchupTargetHeadSequence: null, lastSuccessfulSyncAt: null };
}

function outbox(assetId: string | null = null): DurableOutboxMutation {
  return { position: 1, mutation: { protocolVersion: 1, accountId: ACCOUNT, mutationId: MUTATION, originDeviceId: DEVICE, entityType: 'item', entityId: 'item-1', action: 'create', baseServerVersion: null, changedFields: ['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt'], baseValues: {}, newValues: { type: assetId ? 'image' : 'note', title: 'A', body: assetId ? 'caption' : 'body', url: null, assetId, tags: [], collectionId: null, pinned: false, archived: false, createdAt: 1, updatedAt: 1 } }, createdLocalRevision: 1, dependsOnAssetId: assetId, state: 'queued', attemptCount: 0, lastErrorCode: null, queuedAt: 1 };
}

class FakeLocal implements LocalSyncRepository {
  profile: LocalSyncProfile = { profileKind: 'account', accountId: ACCOUNT, deviceId: DEVICE, syncEnabled: true };
  checkpoint = checkpoint();
  rows: DurableOutboxMutation[] = [];
  bootstrapPages: LocalBootstrapPage[] = [];
  pushed: LocalPushResultApplication[][] = [];
  remote: Array<{ changes: readonly SyncChange[]; cursor: number; complete?: number }> = [];
  resets = 0;
  uploadFailures = 0;
  upload: LocalAssetUploadCandidate = { assetId: ASSET, imagePath: 'images/a.png', uploadState: 'pending', remoteState: 'unknown', uploadAttempts: 0 };
  download: LocalAssetDownloadCandidate = { assetId: ASSET, imagePath: 'images/remote-a.png', mimeType: 'image/png', byteSize: 4, localState: 'remote_known_not_downloaded', downloadAttempts: 0 };
  async getLocalSyncProfile(){return ok(this.profile)} async getLocalSyncCheckpoint(){return ok(this.checkpoint)}
  async getEntitySyncState():Promise<Result<LocalEntitySyncState>>{return ok({entityType:'item',entityId:'item-1',localRevision:1,serverVersion:1,lastSyncedLocalRevision:1})}
  async listDurableOutbox(limit=100){return ok(this.rows.slice(0,limit))}
  async updateBootstrapCheckpoint(update:any){this.checkpoint={...this.checkpoint,initialSyncState:update.initialSyncState,...(update.catchupTargetHeadSequence!==undefined?{catchupTargetHeadSequence:update.catchupTargetHeadSequence}:{})};return ok(undefined)}
  async applyBootstrapPage(page:LocalBootstrapPage){this.bootstrapPages.push(page);this.checkpoint={...this.checkpoint,pullCursor:page.nextAfterOrdinal===null?page.snapshotHeadSequence:this.checkpoint.pullCursor,initialSyncState:page.nextAfterOrdinal===null?'catching_up':'bootstrapping',bootstrapSessionId:page.sessionId,bootstrapAfterOrdinal:page.nextAfterOrdinal,bootstrapSnapshotHeadSequence:page.snapshotHeadSequence};return ok(undefined)}
  async resetBootstrapForRetry(){this.resets+=1;this.checkpoint=checkpoint('not_started');return ok(undefined)}
  async applyPushResults(apps:readonly LocalPushResultApplication[]):Promise<Result<LocalPushApplySummary>>{this.pushed.push([...apps]);for(const app of apps){if(app.result.kind==='accepted')this.rows=this.rows.filter(r=>r.mutation.mutationId!==app.result.mutationId)}return ok({accepted:apps.filter(a=>a.result.kind==='accepted').length,conflicts:apps.filter(a=>a.result.kind==='conflict').length,resolvedConflicts:0,rejected:apps.filter(a=>a.result.kind==='rejected').length,blockedMutationIds:apps.filter(a=>a.result.kind!=='accepted').map(a=>a.result.mutationId)})}
  async markOutboxTransportFailure(){return ok(undefined)}
  async getAssetUploadCandidate(){return ok(this.upload)} async markAssetUploadAttempt(){this.upload={...this.upload,uploadAttempts:this.upload.uploadAttempts+1};return ok(undefined)} async markAssetUploadReady(asset:CanonicalAsset){this.upload={...this.upload,remoteState:'ready',uploadState:'uploaded'};return ok(undefined)} async markAssetUploadFailed(){this.uploadFailures+=1;this.upload={...this.upload,uploadState:'failed'};return ok(undefined)}
  async getAssetDownloadCandidateForPath(){return ok(this.download)} async markAssetDownloadAttempt(){return ok(undefined)} async markAssetDownloaded(){this.download={...this.download,localState:'available'};return ok(undefined)} async markAssetDownloadFailed(){return ok(undefined)}
  async applyRemoteChanges(changes:readonly SyncChange[],cursor:number,_floor?:number,options?:Readonly<{completeInitialSyncAtTarget?:number}>){this.remote.push({changes,cursor,...(options?.completeInitialSyncAtTarget!==undefined?{complete:options.completeInitialSyncAtTarget}:{})});this.checkpoint={...this.checkpoint,pullCursor:cursor,lastSuccessfulSyncAt:Date.now(),...(options?.completeInitialSyncAtTarget!==undefined?{initialSyncState:'complete' as const,bootstrapSessionId:null,bootstrapAfterOrdinal:null,bootstrapSnapshotHeadSequence:null,catchupTargetHeadSequence:null}:{})};return ok(undefined)}
}

function transports(overrides?: Partial<{ push: (req:any)=>Promise<PushMutationsResponse>; pull:(req:any)=>Promise<PullChangesResponse>; bootstrap:(req:any)=>Promise<any> }>) {
  const push = vi.fn(overrides?.push ?? (async (req:any) => ({ kind:'ok', protocolVersion:1, accountId:ACCOUNT, results:req.mutations.map((m:any)=>({kind:'accepted',mutationId:m.mutationId,canonical:{entityType:'item',entity:{id:m.entityId,type:'note',title:'A',body:'body',url:null,assetId:null,tags:[],collectionId:null,pinned:false,archived:false,createdAt:1,updatedAt:1,version:1}},serverVersion:1,changeSequence:1,changed:true,warnings:[]})), headSequence:1 })));
  const pull = vi.fn(overrides?.pull ?? (async (req:any) => ({ kind:'page', protocolVersion:1, accountId:ACCOUNT, changes:[], nextAfterSequence:req.afterSequence, targetHeadSequence:req.afterSequence, minimumRetainedSequence:1, hasMore:false })));
  const bootstrap = vi.fn(overrides?.bootstrap ?? (async () => ({ kind:'page', protocolVersion:1, accountId:ACCOUNT, sessionId:'session', snapshotHeadSequence:0, entries:[], nextAfterOrdinal:null, expiresAtEpochMs:Date.now()+10000 })));
  const asset = { createStaging:vi.fn(async()=>({kind:'staging',assetId:ASSET,storagePath:`${ACCOUNT}/${ASSET}/original.png`,version:1})), upload:vi.fn(async()=>undefined), finalize:vi.fn(async()=>({kind:'ready',asset:{entityType:'asset',entity:{id:ASSET,mimeType:'image/png',byteSize:4,remoteState:'ready',version:2}},changeSequence:1})), download:vi.fn(async()=>({bytes:new Uint8Array([137,80,78,71]),contentType:'image/png'})) };
  return { sync:{pushMutations:push,pullChanges:pull,bootstrap} as unknown as SupabaseSyncTransport, assetTransport:asset as unknown as SupabaseAssetTransport, push,pull,bootstrap,asset };
}

function images(){return {resolve:vi.fn(async()=>ok({kind:'missing'} as const)),readForSync:vi.fn(async()=>ok({bytes:new Uint8Array([137,80,78,71]),mimeType:'image/png' as const,byteSize:4})),writeDownloadedAsset:vi.fn(async()=>ok('images/remote-a.png' as RelativeImagePath))};}

describe('Phase 6D SyncEngine',()=>{
  it('does not send account mutations for local-only/no-auth profile',async()=>{const local=new FakeLocal();local.profile={profileKind:'local-only',accountId:null,deviceId:DEVICE,syncEnabled:false};local.rows=[outbox()];const t=transports();const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('startup');expect(t.push).not.toHaveBeenCalled();expect(t.pull).not.toHaveBeenCalled();});

  it('pushes durable UUID, persists canonical result before removal, then finite-pulls',async()=>{const local=new FakeLocal();local.rows=[outbox()];const t=transports();const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);const state=await engine.runOnce('manual');expect(t.push.mock.calls[0][0].mutations[0].mutationId).toBe(MUTATION);expect(local.pushed).toHaveLength(1);expect(local.rows).toHaveLength(0);expect(t.pull).toHaveBeenCalled();expect(state.kind).toBe('synced');});

  it('publishes local Saved before Syncing and never lets its pending refresh overwrite a newer sync state',async()=>{const local=new FakeLocal();local.rows=[outbox()];const t=transports();const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);const states:string[]=[];engine.subscribe(state=>states.push(state.kind));engine.noteLocalSave();await engine.runOnce('local-write');await Promise.resolve();expect(states.indexOf('local_saved')).toBeLessThan(states.indexOf('syncing'));expect(states.at(-1)).toBe('synced');});

  it('retains the same mutation UUID after a transient push failure',async()=>{const local=new FakeLocal();local.rows=[outbox()];let attempt=0;const t=transports({push:async req=>{attempt+=1;if(attempt===1)throw new Error('offline');return {kind:'ok',protocolVersion:1,accountId:ACCOUNT,results:req.mutations.map((m:any)=>({kind:'accepted',mutationId:m.mutationId,canonical:{entityType:'item',entity:{id:m.entityId,type:'note',title:'A',body:'body',url:null,assetId:null,tags:[],collectionId:null,pinned:false,archived:false,createdAt:1,updatedAt:1,version:1}},serverVersion:1,changeSequence:1,changed:true,warnings:[]})),headSequence:1};}});const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('manual');expect(local.rows[0].mutation.mutationId).toBe(MUTATION);await engine.runOnce('retry');expect(t.push.mock.calls[1][0].mutations[0].mutationId).toBe(MUTATION);});

  it('uploads a blocking Asset before the dependent Item mutation',async()=>{const local=new FakeLocal();local.rows=[outbox(ASSET)];const t=transports();const order:string[]=[];t.asset.createStaging.mockImplementation(async()=>{order.push('staging');return {kind:'staging',assetId:ASSET,storagePath:`${ACCOUNT}/${ASSET}/original.png`,version:1};});t.asset.upload.mockImplementation(async()=>{order.push('upload');});t.asset.finalize.mockImplementation(async()=>{order.push('finalize');return {kind:'ready',asset:{entityType:'asset',entity:{id:ASSET,mimeType:'image/png',byteSize:4,remoteState:'ready',version:2}},changeSequence:1};});t.push.mockImplementation(async (req:any)=>{order.push('push');return {kind:'ok',protocolVersion:1,accountId:ACCOUNT,results:req.mutations.map((m:any)=>({kind:'accepted',mutationId:m.mutationId,canonical:{entityType:'item',entity:{...m.newValues,id:m.entityId,version:1}},serverVersion:1,changeSequence:2,changed:true,warnings:[]})),headSequence:2};});const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('manual');expect(order).toEqual(['staging','upload','finalize','push']);});

  it('keeps an Asset-backed mutation durable when upload fails so retry can use the same mutation UUID',async()=>{const local=new FakeLocal();local.rows=[outbox(ASSET)];const t=transports();t.asset.upload.mockRejectedValueOnce(new Error('upload offline'));const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);const state=await engine.runOnce('manual');expect(state.kind).toBe('error');expect(local.rows).toHaveLength(1);expect(local.rows[0].mutation.mutationId).toBe(MUTATION);expect(local.uploadFailures).toBe(1);expect(t.push).not.toHaveBeenCalled();});

  it('bootstraps a fresh account and atomically completes catch-up at the finite target',async()=>{const local=new FakeLocal();local.checkpoint=checkpoint('not_started');const t=transports({pull:async req=>({kind:'page',protocolVersion:1,accountId:ACCOUNT,changes:[],nextAfterSequence:5,targetHeadSequence:5,minimumRetainedSequence:1,hasMore:false}),bootstrap:async()=>({kind:'page',protocolVersion:1,accountId:ACCOUNT,sessionId:'s',snapshotHeadSequence:3,entries:[],nextAfterOrdinal:null,expiresAtEpochMs:9999999999999})});const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('startup');expect(local.bootstrapPages).toHaveLength(1);expect(local.remote.some(x=>x.complete===5)).toBe(true);expect(local.checkpoint.initialSyncState).toBe('complete');expect(t.pull.mock.calls[0][0].targetHeadSequence).toBeNull();});

  it('restarts an expired bootstrap session and completes from a fresh materialized snapshot',async()=>{const local=new FakeLocal();local.checkpoint={...checkpoint('bootstrapping'),bootstrapSessionId:'expired',bootstrapAfterOrdinal:2,bootstrapSnapshotHeadSequence:3};let boot=0;const t=transports({bootstrap:async()=>{boot+=1;if(boot===1)return {kind:'bootstrap_expired',protocolVersion:1,accountId:ACCOUNT,message:'expired'};return {kind:'page',protocolVersion:1,accountId:ACCOUNT,sessionId:'fresh',snapshotHeadSequence:4,entries:[],nextAfterOrdinal:null,expiresAtEpochMs:9999999999999};}});const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('retry');expect(local.resets).toBe(1);expect(t.bootstrap).toHaveBeenCalledTimes(2);expect(local.checkpoint.initialSyncState).toBe('complete');});

  it('still finite-pulls when there is no authored outbox work',async()=>{const local=new FakeLocal();const t=transports();const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('poll');expect(t.push).not.toHaveBeenCalled();expect(t.pull).toHaveBeenCalledTimes(1);});

  it('rebootstraps on stale cursor when no authored work is pending',async()=>{const local=new FakeLocal();let pullCount=0;const t=transports({pull:async req=>{pullCount+=1;if(pullCount===1)return {kind:'rebootstrap_required',protocolVersion:1,accountId:ACCOUNT,minimumRetainedSequence:9,serverHeadSequence:10};return {kind:'page',protocolVersion:1,accountId:ACCOUNT,changes:[],nextAfterSequence:req.afterSequence,targetHeadSequence:req.afterSequence,minimumRetainedSequence:9,hasMore:false};}});const engine=new SyncEngine(local,t.sync,t.assetTransport,images() as never);await engine.runOnce('manual');expect(local.resets).toBe(1);expect(t.bootstrap).toHaveBeenCalled();});

  it('lazy-downloads a ready remote Asset and subsequent resolve can hit local cache',async()=>{const local=new FakeLocal();const t=transports();let available=false;const store=images();store.resolve.mockImplementation(async()=>ok(available?{kind:'available',uri:'file://cached'} as const:{kind:'missing'} as const));store.writeDownloadedAsset.mockImplementation(async()=>{available=true;return ok('images/remote-a.png' as RelativeImagePath);});const engine=new SyncEngine(local,t.sync,t.assetTransport,store as never);await engine.ensureAssetForImagePath('images/remote-a.png');expect(t.asset.download).toHaveBeenCalledTimes(1);await engine.ensureAssetForImagePath('images/remote-a.png');expect(t.asset.download).toHaveBeenCalledTimes(1);});

  it('resolves the actual downloaded cache path on the first remote-image request',async()=>{const local=new FakeLocal();const t=transports();const placeholder='images/remote-a.jpg' as RelativeImagePath;const cached='images/remote-a.png' as RelativeImagePath;const base={copySelected:vi.fn(),removeFile:vi.fn(),resolve:vi.fn(async(path:RelativeImagePath)=>ok(path===cached?{kind:'available',uri:'file://cached.png'} as const:{kind:'missing'} as const))};const backing=images();backing.resolve=base.resolve;backing.writeDownloadedAsset.mockResolvedValue(ok(cached));local.download={...local.download,imagePath:placeholder};const engine=new SyncEngine(local,t.sync,t.assetTransport,backing as never);const aware=new SyncAwareImageStore(base as never,engine);const result=await aware.resolve(placeholder);expect(result).toEqual(ok({kind:'available',uri:'file://cached.png'}));expect(base.resolve).toHaveBeenNthCalledWith(1,placeholder);expect(base.resolve).toHaveBeenLastCalledWith(cached);});
});
