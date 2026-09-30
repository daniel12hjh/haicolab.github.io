-- ENG2112 ADD-ON. Run ONCE in the existing ENG3510 Supabase project (ybotwermtuxtohbwyznm).
-- Creates separate ENG2112 tables, RPCs and an image bucket. Existing data is not moved.
-- Existing ENG3510 signup behavior is retained; ENG2112 signup is routed by course code.
begin;
-- Abort safely unless this is the existing ENG3510 backend with the expected signup hook.
do $$ begin
  if to_regprocedure('public.tb_read()') is null or to_regclass('team_private.roster') is null then
    raise exception 'Run this migration in the existing ENG3510 Supabase project.';
  end if;
  if position('ENG3510' in pg_get_functiondef('public.tb_read()'::regprocedure))=0 then
    raise exception 'This is not the ENG3510 backend. No changes were applied.';
  end if;
  if not exists(select 1 from pg_trigger where tgname='team_signup' and tgrelid='auth.users'::regclass and tgfoid='team_private.handle_signup()'::regprocedure) then
    raise exception 'The existing signup hook differs from the expected setup. No changes were applied.';
  end if;
end $$;
create schema if not exists eng2112_private;
revoke all on schema eng2112_private from public, anon, authenticated;

create table eng2112_private.roster (
  student_number text primary key check (length(student_number) between 2 and 30),
  invite_hash text not null,
  role text not null default 'student' check (role in ('student','admin')),
  claimed_by uuid unique references auth.users(id),
  created_at timestamptz not null default now()
);
create sequence eng2112_private.student_ids;
create table eng2112_private.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_id integer not null unique,
  student_number text not null unique references eng2112_private.roster(student_number),
  role text not null check (role in ('student','admin'))
);
create table eng2112_private.settings (
  id boolean primary key default true check(id),
  submissions_open boolean not null default true,
  matching_open boolean not null default true,
  notice text not null default 'Share an idea and find teammates. Teams may have 1 to 4 members. For an existing team, only the leader needs to post.'
);
insert into eng2112_private.settings default values;
create table eng2112_private.ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references eng2112_private.profiles(id),
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
  target_size integer not null check(target_size between 1 and 4),
  status text not null check(status in ('recruiting','closed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_active_idea on eng2112_private.ideas(owner_id) where status <> 'archived';
create table eng2112_private.members (
  user_id uuid primary key references eng2112_private.profiles(id),
  idea_id uuid not null references eng2112_private.ideas(id),
  joined_at timestamptz not null default now()
);
create table eng2112_private.invites (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references eng2112_private.ideas(id),
  student_number text not null references eng2112_private.roster(student_number),
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);
create unique index one_pending_invite on eng2112_private.invites(idea_id,student_number) where status='pending';
create table eng2112_private.applications (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references eng2112_private.ideas(id),
  applicant_id uuid not null references eng2112_private.profiles(id),
  message text not null check(length(message) between 5 and 3000),
  reply text not null default '' check(length(reply)<=3000),
  status text not null default 'pending' check(status in ('pending','offered','accepted','declined','withdrawn','closed')),
  created_at timestamptz not null default now(),
  unique(idea_id,applicant_id)
);
create table eng2112_private.comments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references eng2112_private.ideas(id),
  author_id uuid not null references eng2112_private.profiles(id),
  body text not null check(length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table eng2112_private.audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references eng2112_private.profiles(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
-- Defense in depth: no browser role receives table privileges or RLS policies.
alter table eng2112_private.roster enable row level security;
alter table eng2112_private.profiles enable row level security;
alter table eng2112_private.settings enable row level security;
alter table eng2112_private.ideas enable row level security;
alter table eng2112_private.members enable row level security;
alter table eng2112_private.invites enable row level security;
alter table eng2112_private.applications enable row level security;
alter table eng2112_private.comments enable row level security;
alter table eng2112_private.audit enable row level security;
revoke all on all tables in schema eng2112_private from public,anon,authenticated;
revoke all on all sequences in schema eng2112_private from public,anon,authenticated;

-- Both classrooms use the same Auth accounts. The original trigger keeps its original
-- function and only skips new signups explicitly marked for ENG2112.
drop trigger team_signup on auth.users;
create trigger team_signup after insert on auth.users for each row
when ((new.raw_user_meta_data->>'course_code') is distinct from 'ENG2112')
execute function team_private.handle_signup();

create function eng2112_private.claim_enrollment(who uuid, sn text, code text) returns void
language plpgsql set search_path='' as $$
declare r eng2112_private.roster;
begin
  if who is null then raise exception 'Sign in to continue.'; end if;
  if exists(select 1 from eng2112_private.profiles where id=who) then return; end if;
  sn:=btrim(sn);code:=btrim(code);
  select * into r from eng2112_private.roster where student_number=sn for update;
  if r.student_number is null or r.claimed_by is not null or code is null
    or r.invite_hash<>encode(sha256(convert_to(code,'UTF8')),'hex') then
    raise exception 'Check your student number and ENG2112 invitation code. If already enrolled, sign in instead.';
  end if;
  insert into eng2112_private.profiles(id,student_number,role,display_id)
  values(who,sn,r.role,case when r.role='admin' then 0 else nextval('eng2112_private.student_ids') end);
  update eng2112_private.roster set claimed_by=who where student_number=sn;
end $$;

create function eng2112_private.handle_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform eng2112_private.claim_enrollment(new.id,new.raw_user_meta_data->>'student_number',new.raw_user_meta_data->>'invite_code');
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)-'invite_code' where id=new.id;
  return new;
end $$;
create trigger eng2112_signup after insert on auth.users for each row
when ((new.raw_user_meta_data->>'course_code')='ENG2112')
execute function eng2112_private.handle_signup();

create function public.eng2112_enroll(student_number text, invite_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform eng2112_private.claim_enrollment(auth.uid(),student_number,invite_code);
  return jsonb_build_object('enrolled',true);
end $$;
revoke all on function public.eng2112_enroll(text,text) from public,anon;
grant execute on function public.eng2112_enroll(text,text) to authenticated;

create function public.eng2112_is_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from eng2112_private.profiles where id=auth.uid());
$$;

create function public.eng2112_read() returns jsonb language plpgsql security definer set search_path='' as $$
declare me eng2112_private.profiles; result jsonb;
begin
  select * into me from eng2112_private.profiles where id=auth.uid();
  if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
  if me.id is null then return jsonb_build_object('course_code','ENG2112','enrollment_required',true,'account_email',(select email from auth.users where id=auth.uid())); end if;
  select jsonb_build_object(
    'course_code','ENG2112',
    'me',to_jsonb(me),
    'settings',(select to_jsonb(s)-'id' from eng2112_private.settings s),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_id',p.display_id,'role',p.role)) from eng2112_private.profiles p),'[]'::jsonb),
    'ideas',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from eng2112_private.ideas i),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m)) from eng2112_private.members m),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from eng2112_private.comments c),'[]'::jsonb),
    'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from eng2112_private.applications a join eng2112_private.ideas i on i.id=a.idea_id where me.role='admin' or a.applicant_id=me.id or i.owner_id=me.id),'[]'::jsonb),
    'invites',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'idea_id',v.idea_id,'status',v.status,'is_mine',v.student_number=me.student_number,'display_id',p.display_id)) from eng2112_private.invites v join eng2112_private.ideas i on i.id=v.idea_id left join eng2112_private.profiles p on p.student_number=v.student_number where me.role='admin' or v.student_number=me.student_number or i.owner_id=me.id),'[]'::jsonb)
  ) into result;
  if me.role='admin' then
    result := result || jsonb_build_object('roster',coalesce((select jsonb_agg(jsonb_build_object(
      'student_number',r.student_number,'display_id',p.display_id,'user_id',p.id,'idea_id',m.idea_id,
      'submitted',exists(select 1 from eng2112_private.ideas i where i.owner_id=p.id) or exists(select 1 from eng2112_private.invites v where v.student_number=r.student_number and v.status='accepted')
    ) order by r.student_number) from eng2112_private.roster r left join eng2112_private.profiles p on p.student_number=r.student_number left join eng2112_private.members m on m.user_id=p.id where r.role='student'),'[]'::jsonb));
  end if;
  return result;
end $$;

-- Used only within the checked mutation RPC. The global transaction lock is appropriate
-- for a 52-person classroom and makes seat allocation and membership changes atomic.
create function eng2112_private.join_team(who uuid, destination uuid) returns void
language plpgsql set search_path='' as $$
declare previous uuid; previous_owner uuid; cap integer; sn text;
begin
 select student_number into sn from eng2112_private.profiles where id=who;
 select idea_id into previous from eng2112_private.members where user_id=who;
 if previous=destination then raise exception 'You are already in this team.'; end if;
 if previous is not null then
   select owner_id into previous_owner from eng2112_private.ideas where id=previous;
   if previous_owner<>who or (select count(*) from eng2112_private.members where idea_id=previous)>1 then
     raise exception 'You already belong to another team. Contact the instructor to correct your membership.';
   end if;
   update eng2112_private.ideas set status='archived',updated_at=now() where id=previous;
   update eng2112_private.invites set status='cancelled' where idea_id=previous and status='pending';
   update eng2112_private.applications set status='closed' where idea_id=previous and status in ('pending','offered');
   delete from eng2112_private.members where user_id=who;
 end if;
 select target_size into cap from eng2112_private.ideas where id=destination and status<>'archived';
 if cap is null or (select count(*) from eng2112_private.members where idea_id=destination)
     +(select count(*) from eng2112_private.invites where idea_id=destination and status='pending')>=cap then
   raise exception 'The team is full or has places reserved for pending teammates.';
 end if;
 insert into eng2112_private.members(user_id,idea_id) values(who,destination);
 update eng2112_private.invites set status='cancelled' where student_number=sn and status='pending';
 update eng2112_private.applications set status='closed' where applicant_id=who and status in ('pending','offered');
 if (select count(*) from eng2112_private.members where idea_id=destination)>=cap then
   update eng2112_private.ideas set status='closed',updated_at=now() where id=destination;
   update eng2112_private.applications set status='closed' where idea_id=destination and status in ('pending','offered');
 end if;
end $$;

create function public.eng2112_action(action text, payload jsonb default '{}'::jsonb) returns jsonb
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

revoke all on all functions in schema eng2112_private from public,anon,authenticated;
revoke all on function public.eng2112_read() from public,anon;
revoke all on function public.eng2112_action(text,jsonb) from public,anon;
revoke all on function public.eng2112_is_member() from public,anon;
grant execute on function public.eng2112_read(),public.eng2112_action(text,jsonb),public.eng2112_is_member() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('eng2112-images','eng2112-images',false,2097152,array['image/webp','image/jpeg','image/png']);
create policy eng2112_image_read on storage.objects for select to authenticated using (
  bucket_id='eng2112-images' and public.eng2112_is_member()
);
create policy eng2112_image_upload on storage.objects for insert to authenticated with check (
  bucket_id='eng2112-images' and public.eng2112_is_member() and (storage.foldername(name))[1]=auth.uid()::text
);
-- No update/delete policy: a student cannot remove the image from an already posted idea.
commit;

-- Save this ONE-TIME professor invitation from the query result; never commit it to Git.
with secret as materialized (select gen_random_uuid()::text as code),
inserted as (
 insert into eng2112_private.roster(student_number,invite_hash,role)
 select 'professor',encode(sha256(convert_to(code,'UTF8')),'hex'),'admin' from secret
 returning student_number
)
select 'professor' as login_student_number,secret.code as professor_invite_code from secret,inserted;
