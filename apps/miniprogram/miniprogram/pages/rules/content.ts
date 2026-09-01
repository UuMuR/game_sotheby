export const RULE_SECTIONS = [
  { id: 'overview', title: '游戏目标与流程', summary: '3～8 名玩家通过四阶段拍卖，以最终现金净余额决定胜负。' },
  { id: 'cards', title: '藏品属性', summary: '每张藏品具有系列、1～5 皇冠、竞拍方式和失窃状态。' },
  { id: 'auctions', title: '五种竞拍', summary: '公开竞价、顺序竞价、一口价、联合拍卖和暗标。' },
  { id: 'settlement', title: '阶段结算', summary: '五色按数量排名，前三名新增单价 30、20、10 万并跨阶段累计。' },
  { id: 'stolen', title: '失窃与负债', summary: '有价值的失窃藏品按皇冠数罚款，余额可降为负数。' },
  { id: 'connection', title: '超时与重连', summary: '离线不暂停对局，各操作按既定超时规则推进。' },
] as const;
