import type { CollectionSeries } from '@sotheby/contracts';

// TODO(CDN_ASSET): 正式藏品图片上传 CDN 后，在此替换资源映射或 CDN 基础地址。
const CDN_BASE_URL = '';

export function resolveCardImage(cardId: string, series: CollectionSeries): string {
  return CDN_BASE_URL
    ? `${CDN_BASE_URL}/collections/v1/${cardId.toLowerCase()}.webp`
    : `/assets/placeholders/${series.toLowerCase()}.svg`;
}

export function fallbackCardImage(series: CollectionSeries): string {
  return `/assets/placeholders/${series.toLowerCase()}.svg`;
}
