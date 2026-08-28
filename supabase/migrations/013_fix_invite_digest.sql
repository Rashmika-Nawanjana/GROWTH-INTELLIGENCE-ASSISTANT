-- Hotfix: digest() requires bytea, not text (fixes invite accept/peek)

create or replace function accept_team_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_hash text;
  v_invite team_invites%rowtype;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'User email not found';
  end if;

  v_hash := encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  select * into v_invite
  from team_invites
  where token_hash = v_hash
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if v_invite.id is null then
    raise exception 'Invite not found or expired';
  end if;

  if lower(v_email) <> lower(v_invite.email::text) then
    raise exception 'EMAIL_MISMATCH:%', v_invite.email::text;
  end if;

  select id into v_existing
  from team_members
  where team_id = v_invite.team_id and user_id = v_uid;

  if v_existing is null then
    insert into team_members (team_id, user_id, role)
    values (v_invite.team_id, v_uid, v_invite.role);
  end if;

  update team_invites set accepted_at = now() where id = v_invite.id;

  return jsonb_build_object(
    'teamId', v_invite.team_id,
    'role', v_invite.role
  );
end;
$$;

create or replace function peek_team_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_invite team_invites%rowtype;
  v_team_name text;
begin
  v_hash := encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  select * into v_invite
  from team_invites
  where token_hash = v_hash
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if v_invite.id is null then
    return null;
  end if;

  select name into v_team_name from teams where id = v_invite.team_id;

  return jsonb_build_object(
    'teamId', v_invite.team_id,
    'teamName', v_team_name,
    'email', v_invite.email::text,
    'role', v_invite.role,
    'expiresAt', v_invite.expires_at
  );
end;
$$;
