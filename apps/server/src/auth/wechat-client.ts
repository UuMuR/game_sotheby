export interface WechatIdentity {
  openId: string;
}

export interface WechatIdentityClient {
  exchangeCode(code: string): Promise<WechatIdentity>;
}

export class HttpWechatIdentityClient implements WechatIdentityClient {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', this.appId);
    url.searchParams.set('secret', this.appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`WeChat login failed with ${response.status}`);
    const payload = (await response.json()) as { openid?: string; errcode?: number; errmsg?: string };
    if (!payload.openid) throw new Error(payload.errmsg ?? `WeChat login failed: ${payload.errcode ?? 'unknown'}`);
    return { openId: payload.openid };
  }
}
