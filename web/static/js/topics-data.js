// 高级专区专题策展（纯函数，可在 Node 测试）：入口全部指向公开数据筛选，不锁内容
export function buildTopics(summary) {
  const s = summary || {};
  const byDifficulty = s.by_difficulty || {};
  const byCategory = s.by_category || {};
  const tags = Array.isArray(s.top_tags) ? s.top_tags : [];
  const topics = [];
  if (byCategory.database) {
    topics.push({
      id: "db",
      title: "会员数据库专题",
      desc: "会员题中数据库方向占比明显更高（对比免费题约 3%），适合集中练习 SQL。",
      href: "#/premium?paid=1&category=database",
      count: byCategory.database,
    });
  }
  if (byDifficulty.hard) {
    topics.push({
      id: "hard",
      title: "会员困难题专题",
      desc: "按难度筛选的会员困难题，与免费题困难占比接近，并非“更难才收费”。",
      href: "#/premium?paid=1&difficulty=hard",
      count: byDifficulty.hard,
    });
  }
  if (s.with_examples) {
    topics.push({
      id: "examples",
      title: "有结构化示例的会员题",
      desc: "附带有结构化示例输入输出的会员题，便于在本地运行器里验证思路。",
      href: "#/premium?paid=1&has_examples=1",
      count: s.with_examples,
    });
  }
  tags.slice(0, 4).forEach((tag) => {
    topics.push({
      id: `tag-${tag.code}`,
      title: `会员题 · ${tag.code}`,
      desc: `按标签 ${tag.code} 策展的会员题集合。`,
      href: `#/premium?paid=1&tag=${encodeURIComponent(tag.code)}`,
      count: tag.count,
    });
  });
  return topics;
}
