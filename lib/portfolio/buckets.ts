// 模块二饼图/柱图用的标准化分类桶。
// 桶的粒度:让普通投资人看一眼就懂,但不要太多导致饼图碎片化。
// 调整这个列表后,需要让用户重新点「AI 智能分类」按钮重新归桶。

export const SECTOR_BUCKETS = [
  '港股科技互联网',
  'A股硬科技',
  '医药生物',
  '消费白酒',
  '金融',
  '新能源',
  '周期资源',
  '军工',
  '地产基建',
  '港股价值',
  '美股全球',
  '宽基指数',
  '债券',
  '货币',
  '其他主题',
] as const;

export type SectorBucket = (typeof SECTOR_BUCKETS)[number];

// 配色与 ECharts 默认色板对齐,易读。
export const BUCKET_COLORS: Record<SectorBucket, string> = {
  港股科技互联网: '#5470c6',
  A股硬科技: '#73c0de',
  医药生物: '#91cc75',
  消费白酒: '#fac858',
  金融: '#ee6666',
  新能源: '#3ba272',
  周期资源: '#fc8452',
  军工: '#9a60b4',
  地产基建: '#ea7ccc',
  港股价值: '#7d8eb1',
  美股全球: '#ffa500',
  宽基指数: '#5b9bd5',
  债券: '#a3a3a3',
  货币: '#cccccc',
  其他主题: '#9e9e9e',
};

export function isSectorBucket(s: string): s is SectorBucket {
  return (SECTOR_BUCKETS as readonly string[]).includes(s);
}
