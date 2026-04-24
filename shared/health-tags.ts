/**
 * 根据菜系字符串粗推断健康标签,喂给 LLM 作为描述钩子。
 * 故意保守 —— 宁可没有,也不要瞎贴。每家店最多 3 个标签。
 *
 * 这些标签会作为 ReasonContext.healthTags 进入 prompt,LLM 可以借机写
 * "清淡暖胃" / "一碗汤面不油腻" 这种感觉偏的句子,让推荐语走心。
 */
export function inferHealthTags(category: string): string[] {
  if (!category) return [];
  const c = category; // 菜系中文为主,不降 case
  const tags = new Set<string>();

  // 清淡 / 少油
  if (/(粤菜|潮汕|潮州|广东|日料|日本|寿司|蒸|清蒸|粥|汤|羹|轻食|沙拉|素食|越南|河粉|生菜|早茶)/.test(c)) {
    tags.add("清淡");
    tags.add("少油");
  }

  // 高蛋白
  if (/(日料|寿司|刺身|牛排|韩餐|烤肉|烧烤|海鲜|鱼|虾|蟹|鸡)/.test(c)) {
    tags.add("高蛋白");
  }

  // 暖胃 (汤水/粥/面/砂锅类)
  if (/(粥|汤|面|火锅|砂锅|煲仔|米粉|拉面|乌冬|馄饨|馒头|包子|羹)/.test(c)) {
    tags.add("暖胃");
  }

  // 碳水为主 —— LLM 偶尔可以点一句"吃碗面就结束了"
  if (/(面|饺子|饼|饭|粉|米粉|烧饼|馅饼|盖浇|披萨|意面)/.test(c)) {
    tags.add("碳水为主");
  }

  // 油盐偏重 —— 反向钩子,LLM 可以写"偶尔吃一次"
  if (/(川菜|湘菜|火锅|烧烤|水煮|麻辣|夜宵|重庆|鸭血|牛杂)/.test(c)) {
    tags.add("油盐偏重");
  }

  return Array.from(tags).slice(0, 3);
}
