const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobCaptchaRepository } = require('../src/jobs/jobCaptchaRepository');
const { JobCaptchaService, CAPTION } = require('../src/jobs/jobCaptchaService');
const { JobCaptchaWorker } = require('../src/jobs/jobCaptchaWorker');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { UserRepository } = require('../src/users/userRepository');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lYoAAAAASUVORK5CYII=', 'base64');
test('real PG/message/menu: private human reply consumed once before AI/history, stale/unknown photos and explicit refresh', async () => {
 const f = await createJobPostgresFixture(); let updateId=90000, photoId=500, sends=0, answers=0, refreshes=0, unknownSend=false, answerMode='solved';
 const accessService=configuredOwnerJobAccess(f.pool,'101');
 const search = new JobSearchRepository(f.pool,{accessService}), repository = new JobCaptchaRepository(f.pool,{accessService});
 let challenge = { outcome:'ready',challengeId:randomUUID(),revision:2,expiresAt:new Date(Date.now()+600000).toISOString(),png };
 const client = { status:async()=>({phase:'active',revision:2}), challenge:async(_userId,refresh)=>{ if(refresh){ refreshes++; challenge={...challenge,challengeId:randomUUID()}; } return challenge; },
  answer:async(args)=>{ answers++; assert.equal(args.text,'первое слово'); if(answerMode==='unknown')throw new Error('lost'); return {outcome:answerMode}; } };
 const service = new JobCaptchaService({repository,client});
 const worker = new JobCaptchaWorker({repository,client,ownerId:f.owner,sendPhoto:async args=>{ sends++;assert.ok(Buffer.isBuffer(args.png));assert.equal(args.caption,CAPTION);if(unknownSend)throw new Error('lostACK');return{message_id:++photoId}; }});
 try {
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101'),($2,'telegram','202')",[f.owner,f.stranger]);
  const initial=await search.ensure({scope:f.scope});
  await search.saveSettings({scope:f.scope,expectedRevision:initial.revision,settings:{...initial.settings,queries:['Fixture'],activated:true,paused:false}});
  const interactions=new TelegramInteractionRepository(f.pool);
  const jobs = new JobTelegramService({pool:f.pool,accessService,ownerTelegramId:'101',searchRepository:search,captchaService:service,usageRepository:{getMonth:async()=>({month:'2026-10',total:0})}});
  const menu = new TelegramMenuService({interactions,jobSearchService:jobs});
  const messages = new TelegramMessageService({accessPolicy:createTelegramAccessPolicy(['101','202']),updateRepository:new TelegramUpdateRepository(f.pool),
   userRepository:new UserRepository(f.pool),conversationRepository:new ConversationRepository(f.pool),menuService:menu,jobCaptchaService:service,
   assistant:{answer:async()=>{throw new Error('CAPTCHA must not reach AI');}}});
  const reply=(text,from=101,chat=from,id=photoId,hint=true)=>({update_id:++updateId,message:{message_id:updateId,from:{id:from},chat:{id:chat,type:chat<0?'group':'private'},text,
   reply_to_message:{message_id:id,...(hint?{photo:[{}],caption:CAPTION}:{})}}});
  const cb=(data,from=101)=>messages.handleCallback({update_id:++updateId,callback_query:{id:String(updateId),from:{id:from},data,message:{message_id:9,chat:{id:from,type:'private'}}}});
  assert.ok((await cb('job:menu')).buttons.flat().some(b=>b.data==='job:captcha'));
  assert.match((await cb('job:captcha_refresh',202)).answer,/личном чате.*разрешении/iu);assert.equal(refreshes,0);
  await worker.tick();await worker.tick();assert.equal(sends,1);
  const before=(await f.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n;
  await messages.handle(reply('первое слово',202));await messages.handle(reply('первое слово',101,-101));assert.equal(answers,0);
  await messages.handle(reply('english words'));assert.equal((await f.pool.query('SELECT status FROM job_captcha_photos')).rows[0].status,'sent');
  const good=reply(' ПЕРВОЕ  СЛОВО '); const concurrent=await Promise.all([messages.handle(good),messages.handle(reply('первое слово'))]); assert.ok(concurrent.some(r=>/подтверждён/.test(r.answer))); assert.equal(answers,1);
  assert.equal((await messages.handle(good)).status,'duplicate');await messages.handle(reply('первое слово'));assert.equal(answers,1);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,before);
  await cb('job:captcha_refresh');await worker.tick();assert.equal(sends,2);assert.equal(refreshes,1);
  const stale=photoId;await cb('job:captcha_refresh');await worker.tick();assert.equal(sends,3);
  await messages.handle(reply('первое слово',101,101,stale));assert.equal(answers,1);
  answerMode='new_challenge'; await messages.handle(reply('первое слово')); assert.equal(answers,2); await worker.tick(); assert.equal(sends,4,'known failed verification queues new picture');
  await f.pool.query("UPDATE job_captcha_photos SET expires_at=now()-interval '1 second' WHERE telegram_message_id=$1",[String(photoId)]);
  await messages.handle(reply('первое слово'));assert.equal(answers,2);
  await cb('job:captcha_refresh');await worker.tick();answerMode='unknown';await messages.handle(reply('первое слово'));await messages.handle(reply('первое слово'));assert.equal(answers,3);
  assert.equal((await f.pool.query("SELECT outcome FROM job_captcha_photos WHERE telegram_message_id=$1",[String(photoId)])).rows[0].outcome,'unknown');
  const beforeUnknownRefresh=refreshes; await worker.tick(); assert.equal(refreshes,beforeUnknownRefresh,'unknown answer does not queue new image');
  unknownSend=true;await cb('job:captcha_refresh');await worker.tick();const sent=sends;challenge={...challenge,challengeId:randomUUID()};await worker.tick();assert.equal(sends,sent,'unknown ACK blocks new IDs');
  unknownSend=false; await cb('job:captcha_refresh'); await worker.tick(); const afterOverride=sends;
  assert.equal((await f.pool.query("SELECT count(*)::int n FROM job_captcha_photos WHERE status='unknown' AND superseded")).rows[0].n,1);
  challenge={...challenge,challengeId:randomUUID()}; await worker.tick(); assert.equal(sends,afterOverride+1,'old uncertain photo no longer blocks later incident');
  await messages.handle(reply('первое слово',101,101,999999));assert.equal(answers,3);
  const rows=(await f.pool.query('SELECT * FROM job_captcha_photos')).rows;assert.ok(!JSON.stringify(rows).includes('первое слово'));assert.ok(!JSON.stringify(rows).includes(png.toString('base64')));
  assert.ok(!JSON.stringify((await f.pool.query('SELECT content FROM messages')).rows).includes('ПЕРВОЕ'));
 }finally{await worker.close();await f.close();}
});
