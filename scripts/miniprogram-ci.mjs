import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const appid = process.env.WECHAT_APP_ID;
const privateKeyPath = process.env.WECHAT_PRIVATE_KEY_PATH;
const action = process.argv[2] ?? 'preview';
if (!appid || !privateKeyPath) {
  throw new Error('WECHAT_APP_ID and WECHAT_PRIVATE_KEY_PATH are required');
}
await access(privateKeyPath);
const ci = await import('miniprogram-ci');
const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: resolve('apps/miniprogram'),
  privateKeyPath,
  ignores: ['node_modules/**/*', 'test/**/*'],
});
if (action === 'upload') {
  await ci.upload({ project, version: process.env.RELEASE_VERSION ?? '0.1.0', desc: process.env.RELEASE_DESC ?? 'MVP build', setting: { es6: true, minify: true } });
} else {
  await ci.preview({ project, desc: process.env.RELEASE_DESC ?? 'MVP preview', setting: { es6: true, minify: true }, qrcodeFormat: 'terminal' });
}
