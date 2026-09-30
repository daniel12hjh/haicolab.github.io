-- ENG3510 ONLY: Run once in the NEW ENG3510 Supabase project. Never run in STS2026.
-- All student data lives in an unexposed schema. Only the two checked RPCs are public.
begin;
create schema if not exists team_private;
revoke all on schema team_private from public, anon, authenticated;

create table team_private.roster (
  student_number text primary key check (length(student_number) between 2 and 30),
  invite_hash text not null,
  role text not null default 'student' check (role in ('student','admin')),
  claimed_by uuid unique references auth.users(id),
  created_at timestamptz not null default now()
);
create sequence team_private.student_ids;
create table team_private.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_id integer not null unique,
  student_number text not null unique references team_private.roster(student_number),
  role text not null check (role in ('student','admin'))
);
create table team_private.settings (
  id boolean primary key default true check(id),
  submissions_open boolean not null default true,
  matching_open boolean not null default true,
  notice text not null default '아이디어를 제안하고, 함께할 동료를 찾아보세요. 이미 구성된 팀은 팀장이 대표로 제출합니다.'
);
insert into team_private.settings default values;
create table team_private.ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references team_private.profiles(id),
  title text not null check(length(title) between 2 and 100),
  summary text not null check(length(summary) between 5 and 180),
  problem text not null check(length(problem) between 10 and 6000),
  outcome text not null check(length(outcome) between 5 and 6000),
  data_plan text not null check(length(data_plan) between 5 and 6000),
  technology text not null check(length(technology) between 5 and 6000),
  contribution text not null check(length(contribution) between 5 and 6000),
  seeking text not null default '' check(length(seeking)<=3000),
  image_path text not null,
  image_alt text not null check(length(image_alt) between 2 and 300),
  target_size integer not null check(target_size between 1 and 3),
  status text not null check(status in ('recruiting','closed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_active_idea on team_private.ideas(owner_id) where status <> 'archived';
create table team_private.members (
  user_id uuid primary key references team_private.profiles(id),
  idea_id uuid not null references team_private.ideas(id),
  joined_at timestamptz not null default now()
);
create table team_private.invites (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references team_private.ideas(id),
  student_number text not null references team_private.roster(student_number),
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);
create unique index one_pending_invite on team_private.invites(idea_id,student_number) where status='pending';
create table team_private.applications (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references team_private.ideas(id),
  applicant_id uuid not null references team_private.profiles(id),
  message text not null check(length(message) between 5 and 3000),
  reply text not null default '' check(length(reply)<=3000),
  status text not null default 'pending' check(status in ('pending','offered','accepted','declined','withdrawn','closed')),
  created_at timestamptz not null default now(),
  unique(idea_id,applicant_id)
);
create table team_private.comments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references team_private.ideas(id),
  author_id uuid not null references team_private.profiles(id),
  body text not null check(length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table team_private.audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references team_private.profiles(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
-- Defense in depth: no browser role receives table privileges or RLS policies.
alter table team_private.roster enable row level security;
alter table team_private.profiles enable row level security;
alter table team_private.settings enable row level security;
alter table team_private.ideas enable row level security;
alter table team_private.members enable row level security;
alter table team_private.invites enable row level security;
alter table team_private.applications enable row level security;
alter table team_private.comments enable row level security;
alter table team_private.audit enable row level security;
revoke all on all tables in schema team_private from public,anon,authenticated;
revoke all on all sequences in schema team_private from public,anon,authenticated;

create function team_private.handle_signup() returns trigger
language plpgsql security definer set search_path='' as $$
declare r team_private.roster; sn text; code text;
begin
  sn := btrim(new.raw_user_meta_data->>'student_number');
  code := btrim(new.raw_user_meta_data->>'invite_code');
  select * into r from team_private.roster where student_number=sn for update;
  if r.student_number is null or r.claimed_by is not null or code is null
    or r.invite_hash <> encode(sha256(convert_to(code,'UTF8')),'hex') then
    raise exception '학번과 개인 초대코드를 확인해 주세요. 이미 가입했다면 로그인해 주세요.';
  end if;
  insert into team_private.profiles(id,student_number,role,display_id) values(new.id,sn,r.role,case when r.role='admin' then 0 else nextval('team_private.student_ids') end);
  update team_private.roster set claimed_by=new.id where student_number=sn;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)-'invite_code' where id=new.id;
  return new;
end $$;
create trigger team_signup after insert on auth.users for each row execute function team_private.handle_signup();

create function public.tb_is_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from team_private.profiles where id=auth.uid());
$$;

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

create function public.tb_read() returns jsonb language plpgsql security definer set search_path='' as $$
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

-- Used only within the checked mutation RPC. The global transaction lock is appropriate
-- for a 30-person classroom and makes seat allocation and membership changes atomic.
create function team_private.join_team(who uuid, destination uuid) returns void
language plpgsql set search_path='' as $$
declare previous uuid; previous_owner uuid; cap integer; sn text;
begin
 select student_number into sn from team_private.profiles where id=who;
 select idea_id into previous from team_private.members where user_id=who;
 if previous=destination then raise exception '이미 이 팀에 속해 있습니다.'; end if;
 if previous is not null then
   select owner_id into previous_owner from team_private.ideas where id=previous;
   if previous_owner<>who or (select count(*) from team_private.members where idea_id=previous)>1 then
     raise exception '이미 다른 팀에 소속되어 있습니다. 교수자에게 소속 정정을 요청해 주세요.';
   end if;
   update team_private.ideas set status='archived',updated_at=now() where id=previous;
   update team_private.invites set status='cancelled' where idea_id=previous and status='pending';
   update team_private.applications set status='closed' where idea_id=previous and status in ('pending','offered');
   delete from team_private.members where user_id=who;
 end if;
 select target_size into cap from team_private.ideas where id=destination and status<>'archived';
 if cap is null or (select count(*) from team_private.members where idea_id=destination)
     +(select count(*) from team_private.invites where idea_id=destination and status='pending')>=cap then
   raise exception '팀 정원이 찼거나 기존 팀원 확인을 기다리는 중입니다.';
 end if;
 insert into team_private.members(user_id,idea_id) values(who,destination);
 update team_private.invites set status='cancelled' where student_number=sn and status='pending';
 update team_private.applications set status='closed' where applicant_id=who and status in ('pending','offered');
 if (select count(*) from team_private.members where idea_id=destination)>=cap then
   update team_private.ideas set status='closed',updated_at=now() where id=destination;
   update team_private.applications set status='closed' where idea_id=destination and status in ('pending','offered');
 end if;
end $$;

create function public.tb_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
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

revoke all on all functions in schema team_private from public,anon,authenticated;
revoke all on function public.tb_read() from public,anon;
revoke all on function public.tb_action(text,jsonb) from public,anon;
revoke all on function public.tb_is_member() from public,anon;
grant execute on function public.tb_read(),public.tb_action(text,jsonb),public.tb_is_member() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-images','team-images',false,2097152,array['image/webp','image/jpeg','image/png']);
create policy team_image_read on storage.objects for select to authenticated using (
  bucket_id='team-images' and public.tb_is_member()
);
create policy team_image_upload on storage.objects for insert to authenticated with check (
  bucket_id='team-images' and public.tb_is_member() and (storage.foldername(name))[1]=auth.uid()::text
);
-- No update/delete policy: a student cannot remove the image from an already posted idea.
commit;

-- Save this ONE-TIME professor invitation from the query result; never commit it to Git.
with secret as materialized (select gen_random_uuid()::text as code),
inserted as (
 insert into team_private.roster(student_number,invite_hash,role)
 select 'professor',encode(sha256(convert_to(code,'UTF8')),'hex'),'admin' from secret
 returning student_number
)
select 'professor' as login_student_number,secret.code as professor_invite_code from secret,inserted;
