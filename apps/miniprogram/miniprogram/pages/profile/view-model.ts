export interface ProfileInput {
  nickname: string;
  avatarUrl: string;
}

export type ProfileValidation =
  | { ok: true; value: ProfileInput }
  | { ok: false; error: 'INVALID_NICKNAME' };

export function validateProfile(input: ProfileInput): ProfileValidation {
  const nickname = input.nickname.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > 12 || /\p{C}/u.test(nickname)) {
    return { ok: false, error: 'INVALID_NICKNAME' };
  }
  return {
    ok: true,
    value: {
      nickname,
      avatarUrl: input.avatarUrl || '/assets/avatars/default.png',
    },
  };
}
