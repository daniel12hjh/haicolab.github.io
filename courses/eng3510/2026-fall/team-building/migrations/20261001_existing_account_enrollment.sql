-- Apply to the EXISTING ENG3510/ENG2112 shared project, not STS2026.
-- Additive, transactional and safe to rerun. Does not enroll students automatically.
begin;
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
commit;
