-- ENG3510 + ENG2112 SHARED PROJECT ONLY (ybotwermtuxtohbwyznm)
-- Includes the earlier ENG3510 existing-account enrollment fix.
-- Update existing functions only. Preserves all accounts, ideas, teams and invitations.
-- Safe to rerun; apply before deploying the updated classroom frontend.
begin;
do $$ begin
  if to_regprocedure('public.tb_read()') is null then
    raise exception 'ENG3510 backend not found. No changes applied.';
  end if;
  if position('ENG3510' in pg_get_functiondef('public.tb_read()'::regprocedure))=0 then
    raise exception 'Wrong project: expected ENG3510. No changes applied.';
  end if;
end $$;
do $$ begin
  if to_regprocedure('public.eng2112_read()') is null then
    raise exception 'ENG2112 backend not found. No changes applied.';
  end if;
  if position('ENG2112' in pg_get_functiondef('public.eng2112_read()'::regprocedure))=0 then
    raise exception 'Wrong project: expected ENG2112. No changes applied.';
  end if;
end $$;

-- Apply to the EXISTING ENG3510/ENG2112 shared project, not STS2026.
-- Additive, transactional and safe to rerun. Does not enroll students automatically.
do $$ begin
  if to_regprocedure('public.tb_read()') is null then
    raise exception 'ENG3510 backend not found. No changes applied.';
  end if;
  if position('ENG3510' in pg_get_functiondef('public.tb_read()'::regprocedure))=0 then
    raise exception 'This is not the ENG3510 backend. No changes applied.';
  end if;
end $$;

-- Existing shared Auth accounts must claim an ENG3510 invitation separately.
create or replace function public.tb_enroll(student_number text, invite_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  sn text := btrim(student_number);
  code text := btrim(invite_code);
  r team_private.roster;
  existing_sn text;
begin
  if who is null or not exists(select 1 from auth.users where id=who) then
    raise exception '먼저 기존 계정으로 로그인해 주세요.';
  end if;
  -- Serialize enrollment attempts by this account, including different student numbers.
  perform pg_advisory_xact_lock(hashtextextended(who::text, 3510));
  select p.student_number into existing_sn from team_private.profiles p where p.id=who;
  if existing_sn is not null then
    if existing_sn=sn then return jsonb_build_object('enrolled',true); end if;
    raise exception '이 계정은 이미 다른 학번으로 ENG3510에 등록되어 있습니다.';
  end if;
  select * into r from team_private.roster where team_private.roster.student_number=sn for update;
  if r.student_number is null or r.claimed_by is not null or code is null
    or r.invite_hash<>encode(sha256(convert_to(code,'UTF8')),'hex') then
    raise exception '학번과 ENG3510 개인 초대코드를 확인해 주세요. 이미 등록했다면 해당 계정으로 로그인해 주세요.';
  end if;
  insert into team_private.profiles(id,student_number,role,display_id)
  values(who,sn,r.role,case when r.role='admin' then 0 else nextval('team_private.student_ids') end);
  update team_private.roster set claimed_by=who where team_private.roster.student_number=sn;
  return jsonb_build_object('enrolled',true);
end $$;
revoke all on function public.tb_enroll(text,text) from public,anon;
grant execute on function public.tb_enroll(text,text) to authenticated;

create or replace function public.tb_read() returns jsonb language plpgsql security definer set search_path='' as $$
declare me team_private.profiles; result jsonb;
begin
  select * into me from team_private.profiles where id=auth.uid();
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception '수업 계정으로 로그인해 주세요.';
  end if;
  if me.id is null then
    return jsonb_build_object('course_code','ENG3510','enrollment_required',true,
      'account_email',(select email from auth.users where id=auth.uid()));
  end if;
  select jsonb_build_object(
    'course_code','ENG3510',
    'me',to_jsonb(me),
    'settings',(select to_jsonb(s)-'id' from team_private.settings s),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_id',p.display_id,'role',p.role)) from team_private.profiles p),'[]'::jsonb),
    'ideas',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from team_private.ideas i),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m)) from team_private.members m),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from team_private.comments c),'[]'::jsonb),
    'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from team_private.applications a join team_private.ideas i on i.id=a.idea_id where me.role='admin' or a.applicant_id=me.id or i.owner_id=me.id),'[]'::jsonb),
    'invites',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'idea_id',v.idea_id,'status',v.status,'is_mine',v.student_number=me.student_number,'display_id',p.display_id)) from team_private.invites v join team_private.ideas i on i.id=v.idea_id left join team_private.profiles p on p.student_number=v.student_number where me.role='admin' or v.student_number=me.student_number or i.owner_id=me.id),'[]'::jsonb)
  ) into result;
  if me.role='admin' then
    result := result || jsonb_build_object('roster',coalesce((select jsonb_agg(jsonb_build_object(
      'student_number',r.student_number,'display_id',p.display_id,'user_id',p.id,'idea_id',m.idea_id,
      'submitted',exists(select 1 from team_private.ideas i where i.owner_id=p.id) or exists(select 1 from team_private.invites v where v.student_number=r.student_number and v.status='accepted')
    ) order by r.student_number) from team_private.roster r left join team_private.profiles p on p.student_number=r.student_number left join team_private.members m on m.user_id=p.id where r.role='student'),'[]'::jsonb));
  end if;
  return result;
end $$;

revoke all on function public.tb_read() from public,anon;
grant execute on function public.tb_read() to authenticated;
notify pgrst, 'reload schema';

create or replace function public.tb_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me team_private.profiles; cfg team_private.settings; i team_private.ideas;
 a team_private.applications; v team_private.invites; rid uuid; n integer; sn text; secret text;
 output jsonb:='{}'::jsonb; status_value text;
begin
 perform pg_advisory_xact_lock(2026092801);
 select * into me from team_private.profiles where id=auth.uid();
 if me.id is null then raise exception '수업 계정으로 로그인해 주세요.'; end if;
 select * into cfg from team_private.settings;
 if action like 'admin_%' and me.role<>'admin' then raise exception '교수자만 사용할 수 있습니다.'; end if;

 if action='save_idea' then
   if not cfg.submissions_open and me.role<>'admin' then raise exception '아이디어 제출·수정이 마감되었습니다.'; end if;
   rid:=nullif(payload->>'id','')::uuid;
   if rid is not null then
     select * into i from team_private.ideas where id=rid;
     if i.id is null or i.owner_id<>me.id then raise exception '본인의 아이디어만 수정할 수 있습니다.'; end if;
     if i.status='archived' then raise exception '보관된 아이디어는 수정할 수 없습니다.'; end if;
   elsif exists(select 1 from team_private.members where user_id=me.id) then
     raise exception '이미 팀에 속해 있습니다. 내 활동에서 대표 게시물을 확인해 주세요.';
   end if;
   if split_part(payload->>'image_path','/',1)<>me.id::text or not exists(
      select 1 from storage.objects where bucket_id='team-images' and name=payload->>'image_path') then
     raise exception '설명 이미지를 먼저 업로드해 주세요.';
   end if;
   n:=(payload->>'target_size')::integer;
   status_value:=payload->>'status';
   if status_value not in ('recruiting','closed') or status_value is null then raise exception '모집 상태를 확인해 주세요.'; end if;
   if n not between 1 and 3 or n is null then raise exception '팀은 1~3명으로 구성합니다.'; end if;
   if rid is not null and n<(select count(*) from team_private.members where idea_id=rid)+(select count(*) from team_private.invites where idea_id=rid and status='pending') then
     raise exception '확정·확인 대기 인원보다 정원을 줄일 수 없습니다.';
   end if;
   if status_value='recruiting' and length(btrim(coalesce(payload->>'seeking','')))<5 then raise exception '함께할 팀원에게 바라는 역할을 적어 주세요.'; end if;
   if n=1 then status_value:='closed'; end if;
   if rid is not null and (select count(*) from team_private.members where idea_id=rid)>=n then status_value:='closed'; end if;
   if rid is null then
     insert into team_private.ideas(owner_id,title,summary,problem,outcome,data_plan,technology,contribution,seeking,image_path,image_alt,target_size,status)
     values(me.id,btrim(payload->>'title'),btrim(payload->>'summary'),btrim(payload->>'problem'),btrim(payload->>'outcome'),btrim(payload->>'data_plan'),btrim(payload->>'technology'),btrim(payload->>'contribution'),btrim(coalesce(payload->>'seeking','')),payload->>'image_path',btrim(payload->>'image_alt'),n,status_value) returning id into rid;
     insert into team_private.members(user_id,idea_id) values(me.id,rid);
   else
     update team_private.ideas set title=btrim(payload->>'title'),summary=btrim(payload->>'summary'),problem=btrim(payload->>'problem'),outcome=btrim(payload->>'outcome'),data_plan=btrim(payload->>'data_plan'),technology=btrim(payload->>'technology'),contribution=btrim(payload->>'contribution'),seeking=btrim(coalesce(payload->>'seeking','')),image_path=payload->>'image_path',image_alt=btrim(payload->>'image_alt'),target_size=n,status=status_value,updated_at=now() where id=rid;
   end if;
   if status_value='closed' then update team_private.applications set status='closed' where idea_id=rid and status in ('pending','offered'); end if;

   -- Optional on new and existing ideas; old clients with no list behave unchanged.
   if jsonb_typeof(coalesce(payload->'existing_members','[]'::jsonb)) is distinct from 'array' then
     raise exception '기존 팀원 학번을 확인해 주세요.';
   end if;
   if jsonb_array_length(coalesce(payload->'existing_members','[]'::jsonb))>2
     or exists(select 1 from jsonb_array_elements(coalesce(payload->'existing_members','[]'::jsonb)) x where jsonb_typeof(x)<>'string') then
     raise exception '기존 팀원 학번을 확인해 주세요.';
   end if;
   for sn in select btrim(value) from jsonb_array_elements_text(coalesce(payload->'existing_members','[]'::jsonb)) loop
     if sn='' then raise exception '기존 팀원 학번을 확인해 주세요.'; end if;
     if exists(select 1 from team_private.invites invite_row where invite_row.idea_id=rid and invite_row.student_number=sn and invite_row.status='pending') then
       raise exception '이미 등록 요청했거나 확정된 팀원입니다. 내 활동에서 확인해 주세요.';
     end if;
     -- Same transaction and course lock: an invalid invitation rolls back the entire save.
     perform public.tb_action('invite_member',jsonb_build_object('idea_id',rid,'student_number',sn));
   end loop;
   output:=jsonb_build_object('id',rid);

 elsif action='comment' then
   if not cfg.matching_open then raise exception '팀빌딩 활동이 마감되었습니다.'; end if;
   rid:=(payload->>'idea_id')::uuid;
   if not exists(select 1 from team_private.ideas where id=rid and status<>'archived') then raise exception '활동 중인 아이디어가 아닙니다.'; end if;
   insert into team_private.comments(idea_id,author_id,body) values(rid,me.id,btrim(payload->>'body'));

 elsif action='delete_comment' then
   delete from team_private.comments where id=(payload->>'id')::uuid and (author_id=me.id or me.role='admin');

 elsif action='apply' then
   if not cfg.matching_open then raise exception '팀 모집이 마감되었습니다.'; end if;
   select * into i from team_private.ideas where id=(payload->>'idea_id')::uuid;
   if i.id is null or i.owner_id=me.id or i.status<>'recruiting' then raise exception '지원 가능한 다른 팀을 선택해 주세요.'; end if;
   if (select count(*) from team_private.members where idea_id=i.id)+(select count(*) from team_private.invites where idea_id=i.id and status='pending')>=i.target_size then raise exception '현재 모집 가능한 자리가 없습니다.'; end if;
   if exists(select 1 from team_private.members m join team_private.ideas x on x.id=m.idea_id where m.user_id=me.id and (x.owner_id<>me.id or (select count(*) from team_private.members where idea_id=x.id)>1)) then raise exception '이미 구성된 팀에 소속되어 있습니다.'; end if;
   insert into team_private.applications(idea_id,applicant_id,message) values(i.id,me.id,btrim(payload->>'message'))
   on conflict(idea_id,applicant_id) do update set message=excluded.message,status='pending',reply='' where team_private.applications.status<>'accepted';

 elsif action='application' then
   if not cfg.matching_open then raise exception '팀 모집이 마감되었습니다.'; end if;
   select * into a from team_private.applications where id=(payload->>'id')::uuid;
   select * into i from team_private.ideas where id=a.idea_id;
   status_value:=payload->>'decision';
   if a.id is null then raise exception '지원 내역을 찾을 수 없습니다.'; end if;
   if status_value in ('offer','reject','reply') and i.owner_id=me.id then
     if a.status not in ('pending','offered') or i.status<>'recruiting' then raise exception '처리 가능한 지원이 아닙니다.'; end if;
     update team_private.applications set status=case status_value when 'offer' then 'offered' when 'reject' then 'declined' else status end,reply=coalesce(payload->>'reply',reply) where id=a.id;
   elsif status_value in ('accept','withdraw') and a.applicant_id=me.id then
     if a.status not in ('pending','offered') then raise exception '이미 처리된 지원입니다.'; end if;
     if status_value='accept' then
       if a.status<>'offered' or i.status<>'recruiting' then raise exception '팀장의 합류 제안이 필요합니다.'; end if;
       perform team_private.join_team(me.id,i.id);
       update team_private.applications set status='accepted' where id=a.id;
     else update team_private.applications set status='withdrawn' where id=a.id; end if;
   else raise exception '지원 처리 권한이 없습니다.'; end if;

 elsif action='invite_member' then
   if not cfg.submissions_open and not cfg.matching_open then raise exception '팀 구성 변경이 마감되었습니다.'; end if;
   select * into i from team_private.ideas where id=(payload->>'idea_id')::uuid;
   if i.id is null or i.owner_id<>me.id or i.status='archived' then raise exception '팀장만 기존 팀원을 등록할 수 있습니다.'; end if;
   sn:=btrim(payload->>'student_number');
   if sn=me.student_number or not exists(select 1 from team_private.roster where student_number=sn and role='student') then raise exception '등록할 수 없는 학번입니다. 교수자에게 확인해 주세요.'; end if;
   if exists(select 1 from team_private.profiles p join team_private.members m on m.user_id=p.id where p.student_number=sn and m.idea_id=i.id) then raise exception '이미 같은 팀에 속해 있습니다.'; end if;
   if (select count(*) from team_private.members where idea_id=i.id)+(select count(*) from team_private.invites where idea_id=i.id and status='pending')>=i.target_size then raise exception '정원을 확인해 주세요. 확인 대기 중인 팀원도 자리를 차지합니다.'; end if;
   insert into team_private.invites(idea_id,student_number) values(i.id,sn);

 elsif action='respond_invite' then
   if not cfg.submissions_open and not cfg.matching_open then raise exception '팀 구성 변경이 마감되었습니다.'; end if;
   select * into v from team_private.invites where id=(payload->>'id')::uuid;
   select * into i from team_private.ideas where id=v.idea_id;
   if v.id is null or v.status<>'pending' then raise exception '확인 대기 중인 초대가 아닙니다.'; end if;
   status_value:=payload->>'decision';
   if status_value='cancel' and i.owner_id=me.id then
     update team_private.invites set status='cancelled' where id=v.id;
   elsif v.student_number=me.student_number and status_value in ('accept','decline') then
     update team_private.invites set status=case when status_value='accept' then 'accepted' else 'declined' end where id=v.id;
     if status_value='accept' then perform team_private.join_team(me.id,v.idea_id); end if;
   else raise exception '초대 처리 권한이 없습니다.'; end if;

 elsif action='admin_roster' then
   for sn in select distinct btrim(value) from jsonb_array_elements_text(payload->'students') loop
     if sn !~ '^[0-9A-Za-z_-]{2,30}$' or sn='professor' then raise exception '학번은 영문·숫자·하이픈으로 2~30자 입력해 주세요.'; end if;
     if not exists(select 1 from team_private.roster where student_number=sn) then
       secret:=gen_random_uuid()::text;
       insert into team_private.roster(student_number,invite_hash) values(sn,encode(sha256(convert_to(secret,'UTF8')),'hex'));
       output:=output||jsonb_build_object(sn,secret);
     end if;
   end loop;

 elsif action='admin_reissue' then
   sn:=payload->>'student_number'; secret:=gen_random_uuid()::text;
   update team_private.roster set invite_hash=encode(sha256(convert_to(secret,'UTF8')),'hex') where student_number=sn and claimed_by is null and role='student';
   if not found then raise exception '미가입 학생의 초대코드만 재발급할 수 있습니다.'; end if;
   output:=jsonb_build_object(sn,secret);

 elsif action='admin_settings' then
   update team_private.settings set submissions_open=(payload->>'submissions_open')::boolean,matching_open=(payload->>'matching_open')::boolean,notice=left(coalesce(payload->>'notice',''),2000);

 elsif action='admin_remove_member' then
   rid:=(payload->>'user_id')::uuid;
   select x.* into i from team_private.members m join team_private.ideas x on x.id=m.idea_id where m.user_id=rid;
   if i.id is null then raise exception '소속 팀이 없습니다.'; end if;
   if i.owner_id=rid then
     update team_private.ideas set status='archived' where id=i.id;
     delete from team_private.members where idea_id=i.id;
     update team_private.invites set status='cancelled' where idea_id=i.id and status in ('pending','accepted');
     update team_private.applications set status='closed' where idea_id=i.id;
   else
     delete from team_private.members where user_id=rid;
     update team_private.invites set status='cancelled' where idea_id=i.id and student_number=(select student_number from team_private.profiles where id=rid) and status='accepted';
     update team_private.applications set status='closed' where idea_id=i.id and applicant_id=rid;
   end if;
   insert into team_private.audit(actor_id,action,details) values(me.id,action,payload);
 else raise exception '지원하지 않는 요청입니다.';
 end if;
 return output;
end $$;

revoke all on function public.tb_action(text,jsonb) from public,anon;
grant execute on function public.tb_action(text,jsonb) to authenticated;

create or replace function public.eng2112_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me eng2112_private.profiles; cfg eng2112_private.settings; i eng2112_private.ideas;
 a eng2112_private.applications; v eng2112_private.invites; rid uuid; n integer; sn text; secret text;
 output jsonb:='{}'::jsonb; status_value text;
begin
 perform pg_advisory_xact_lock(2026093001);
 select * into me from eng2112_private.profiles where id=auth.uid();
 if me.id is null then raise exception 'Sign in with an enrolled course account.'; end if;
 select * into cfg from eng2112_private.settings;
 if action like 'admin_%' and me.role<>'admin' then raise exception 'Only the instructor can perform this action.'; end if;

 if action='save_idea' then
   if not cfg.submissions_open and me.role<>'admin' then raise exception 'Idea submission and editing are closed.'; end if;
   rid:=nullif(payload->>'id','')::uuid;
   if rid is not null then
     select * into i from eng2112_private.ideas where id=rid;
     if i.id is null or i.owner_id<>me.id then raise exception 'You can only edit your own idea.'; end if;
     if i.status='archived' then raise exception 'Archived ideas cannot be edited.'; end if;
   elsif exists(select 1 from eng2112_private.members where user_id=me.id) then
     raise exception 'You already belong to a team. View its representative post in My activity.';
   end if;
   if split_part(payload->>'image_path','/',1)<>me.id::text or not exists(
      select 1 from storage.objects where bucket_id='eng2112-images' and name=payload->>'image_path') then
     raise exception 'Upload an explanatory image first.';
   end if;
   n:=(payload->>'target_size')::integer;
   status_value:=payload->>'status';
   if status_value not in ('recruiting','closed') or status_value is null then raise exception 'Check the recruitment setting.'; end if;
   if n not between 1 and 4 or n is null then raise exception 'Teams must have between 1 and 4 members.'; end if;
   if rid is not null and n<(select count(*) from eng2112_private.members where idea_id=rid)+(select count(*) from eng2112_private.invites where idea_id=rid and status='pending') then
     raise exception 'The target size cannot be smaller than the confirmed and pending members.';
   end if;
   if status_value='recruiting' and length(btrim(coalesce(payload->>'seeking','')))<5 then raise exception 'Describe the roles you are recruiting for.'; end if;
   if n=1 then status_value:='closed'; end if;
   if rid is not null and (select count(*) from eng2112_private.members where idea_id=rid)>=n then status_value:='closed'; end if;
   if rid is null then
     insert into eng2112_private.ideas(owner_id,title,summary,problem,outcome,data_plan,technology,contribution,seeking,image_path,image_alt,target_size,status)
     values(me.id,btrim(payload->>'title'),btrim(payload->>'summary'),btrim(payload->>'problem'),btrim(payload->>'outcome'),btrim(payload->>'data_plan'),btrim(payload->>'technology'),btrim(payload->>'contribution'),btrim(coalesce(payload->>'seeking','')),payload->>'image_path',btrim(payload->>'image_alt'),n,status_value) returning id into rid;
     insert into eng2112_private.members(user_id,idea_id) values(me.id,rid);
   else
     update eng2112_private.ideas set title=btrim(payload->>'title'),summary=btrim(payload->>'summary'),problem=btrim(payload->>'problem'),outcome=btrim(payload->>'outcome'),data_plan=btrim(payload->>'data_plan'),technology=btrim(payload->>'technology'),contribution=btrim(payload->>'contribution'),seeking=btrim(coalesce(payload->>'seeking','')),image_path=payload->>'image_path',image_alt=btrim(payload->>'image_alt'),target_size=n,status=status_value,updated_at=now() where id=rid;
   end if;
   if status_value='closed' then update eng2112_private.applications set status='closed' where idea_id=rid and status in ('pending','offered'); end if;

   -- Optional on new and existing ideas; old clients with no list behave unchanged.
   if jsonb_typeof(coalesce(payload->'existing_members','[]'::jsonb)) is distinct from 'array' then
     raise exception 'Check the existing teammate student numbers.';
   end if;
   if jsonb_array_length(coalesce(payload->'existing_members','[]'::jsonb))>3
     or exists(select 1 from jsonb_array_elements(coalesce(payload->'existing_members','[]'::jsonb)) x where jsonb_typeof(x)<>'string') then
     raise exception 'Check the existing teammate student numbers.';
   end if;
   for sn in select btrim(value) from jsonb_array_elements_text(coalesce(payload->'existing_members','[]'::jsonb)) loop
     if sn='' then raise exception 'Check the existing teammate student numbers.'; end if;
     if exists(select 1 from eng2112_private.invites invite_row where invite_row.idea_id=rid and invite_row.student_number=sn and invite_row.status='pending') then
       raise exception 'A teammate is already invited or confirmed. Check My activity.';
     end if;
     -- Same transaction and course lock: an invalid invitation rolls back the entire save.
     perform public.eng2112_action('invite_member',jsonb_build_object('idea_id',rid,'student_number',sn));
   end loop;
   output:=jsonb_build_object('id',rid);

 elsif action='comment' then
   if not cfg.matching_open then raise exception 'Team-building activity is closed.'; end if;
   rid:=(payload->>'idea_id')::uuid;
   if not exists(select 1 from eng2112_private.ideas where id=rid and status<>'archived') then raise exception 'This idea is not active.'; end if;
   insert into eng2112_private.comments(idea_id,author_id,body) values(rid,me.id,btrim(payload->>'body'));

 elsif action='delete_comment' then
   delete from eng2112_private.comments where id=(payload->>'id')::uuid and (author_id=me.id or me.role='admin');

 elsif action='apply' then
   if not cfg.matching_open then raise exception 'Team matching is closed.'; end if;
   select * into i from eng2112_private.ideas where id=(payload->>'idea_id')::uuid;
   if i.id is null or i.owner_id=me.id or i.status<>'recruiting' then raise exception 'Choose another team that is recruiting.'; end if;
   if (select count(*) from eng2112_private.members where idea_id=i.id)+(select count(*) from eng2112_private.invites where idea_id=i.id and status='pending')>=i.target_size then raise exception 'This team has no available places.'; end if;
   if exists(select 1 from eng2112_private.members m join eng2112_private.ideas x on x.id=m.idea_id where m.user_id=me.id and (x.owner_id<>me.id or (select count(*) from eng2112_private.members where idea_id=x.id)>1)) then raise exception 'You already belong to an established team.'; end if;
   insert into eng2112_private.applications(idea_id,applicant_id,message) values(i.id,me.id,btrim(payload->>'message'))
   on conflict(idea_id,applicant_id) do update set message=excluded.message,status='pending',reply='' where eng2112_private.applications.status<>'accepted';

 elsif action='application' then
   if not cfg.matching_open then raise exception 'Team matching is closed.'; end if;
   select * into a from eng2112_private.applications where id=(payload->>'id')::uuid;
   select * into i from eng2112_private.ideas where id=a.idea_id;
   status_value:=payload->>'decision';
   if a.id is null then raise exception 'Application not found.'; end if;
   if status_value in ('offer','reject','reply') and i.owner_id=me.id then
     if a.status not in ('pending','offered') or i.status<>'recruiting' then raise exception 'This application is no longer open.'; end if;
     update eng2112_private.applications set status=case status_value when 'offer' then 'offered' when 'reject' then 'declined' else status end,reply=coalesce(payload->>'reply',reply) where id=a.id;
   elsif status_value in ('accept','withdraw') and a.applicant_id=me.id then
     if a.status not in ('pending','offered') then raise exception 'This application has already been processed.'; end if;
     if status_value='accept' then
       if a.status<>'offered' or i.status<>'recruiting' then raise exception 'The leader must make an offer before you can accept.'; end if;
       perform eng2112_private.join_team(me.id,i.id);
       update eng2112_private.applications set status='accepted' where id=a.id;
     else update eng2112_private.applications set status='withdrawn' where id=a.id; end if;
   else raise exception 'You cannot change this application.'; end if;

 elsif action='invite_member' then
   if not cfg.submissions_open and not cfg.matching_open then raise exception 'Team membership changes are closed.'; end if;
   select * into i from eng2112_private.ideas where id=(payload->>'idea_id')::uuid;
   if i.id is null or i.owner_id<>me.id or i.status='archived' then raise exception 'Only the leader can invite existing teammates.'; end if;
   sn:=btrim(payload->>'student_number');
   if sn=me.student_number or not exists(select 1 from eng2112_private.roster where student_number=sn and role='student') then raise exception 'This student number cannot be invited. Check with the instructor.'; end if;
   if exists(select 1 from eng2112_private.profiles p join eng2112_private.members m on m.user_id=p.id where p.student_number=sn and m.idea_id=i.id) then raise exception 'This student is already in your team.'; end if;
   if (select count(*) from eng2112_private.members where idea_id=i.id)+(select count(*) from eng2112_private.invites where idea_id=i.id and status='pending')>=i.target_size then raise exception 'Check the target size. Pending invitations also reserve places.'; end if;
   insert into eng2112_private.invites(idea_id,student_number) values(i.id,sn);

 elsif action='respond_invite' then
   if not cfg.submissions_open and not cfg.matching_open then raise exception 'Team membership changes are closed.'; end if;
   select * into v from eng2112_private.invites where id=(payload->>'id')::uuid;
   select * into i from eng2112_private.ideas where id=v.idea_id;
   if v.id is null or v.status<>'pending' then raise exception 'This invitation is no longer pending.'; end if;
   status_value:=payload->>'decision';
   if status_value='cancel' and i.owner_id=me.id then
     update eng2112_private.invites set status='cancelled' where id=v.id;
   elsif v.student_number=me.student_number and status_value in ('accept','decline') then
     update eng2112_private.invites set status=case when status_value='accept' then 'accepted' else 'declined' end where id=v.id;
     if status_value='accept' then perform eng2112_private.join_team(me.id,v.idea_id); end if;
   else raise exception 'You cannot change this invitation.'; end if;

 elsif action='admin_roster' then
   for sn in select distinct btrim(value) from jsonb_array_elements_text(payload->'students') loop
     if sn !~ '^[0-9A-Za-z_-]{2,30}$' or sn='professor' then raise exception 'Student numbers must contain 2 to 30 letters, digits, underscores, or hyphens.'; end if;
     if not exists(select 1 from eng2112_private.roster where student_number=sn) then
       secret:=gen_random_uuid()::text;
       insert into eng2112_private.roster(student_number,invite_hash) values(sn,encode(sha256(convert_to(secret,'UTF8')),'hex'));
       output:=output||jsonb_build_object(sn,secret);
     end if;
   end loop;

 elsif action='admin_reissue' then
   sn:=payload->>'student_number'; secret:=gen_random_uuid()::text;
   update eng2112_private.roster set invite_hash=encode(sha256(convert_to(secret,'UTF8')),'hex') where student_number=sn and claimed_by is null and role='student';
   if not found then raise exception 'You can only reissue invitations for students who have not registered.'; end if;
   output:=jsonb_build_object(sn,secret);

 elsif action='admin_settings' then
   update eng2112_private.settings set submissions_open=(payload->>'submissions_open')::boolean,matching_open=(payload->>'matching_open')::boolean,notice=left(coalesce(payload->>'notice',''),2000);

 elsif action='admin_remove_member' then
   rid:=(payload->>'user_id')::uuid;
   select x.* into i from eng2112_private.members m join eng2112_private.ideas x on x.id=m.idea_id where m.user_id=rid;
   if i.id is null then raise exception 'This student has no team.'; end if;
   if i.owner_id=rid then
     update eng2112_private.ideas set status='archived' where id=i.id;
     delete from eng2112_private.members where idea_id=i.id;
     update eng2112_private.invites set status='cancelled' where idea_id=i.id and status in ('pending','accepted');
     update eng2112_private.applications set status='closed' where idea_id=i.id;
   else
     delete from eng2112_private.members where user_id=rid;
     update eng2112_private.invites set status='cancelled' where idea_id=i.id and student_number=(select student_number from eng2112_private.profiles where id=rid) and status='accepted';
     update eng2112_private.applications set status='closed' where idea_id=i.id and applicant_id=rid;
   end if;
   insert into eng2112_private.audit(actor_id,action,details) values(me.id,action,payload);
 else raise exception 'Unsupported request.';
 end if;
 return output;
end $$;

revoke all on function public.eng2112_action(text,jsonb) from public,anon;
grant execute on function public.eng2112_action(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
