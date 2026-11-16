export function mergeRows(previous, rows) {
  if (rows.length === 0 && previous.length === 0) return [];
  if (rows.length && rows.every(row => row.id) && previous.every(row => row.id)) {
    const known = new Map(previous.map(row => [row.id, row.text]));
    const result = [...previous];
    for (const row of rows) {
      if (known.has(row.id)) {
        if (known.get(row.id) !== row.text) return null;
      } else {
        known.set(row.id, row.text);
        result.push(row);
      }
    }
    return result;
  }
  // Without stable IDs, accept only an append-only list. Text alone cannot identify a post.
  if (previous.every((row, index) => rows[index]?.text === row.text)) return rows;
  return null;
}
export const signature = products => products.map(product => product.id).join(',');
export const questionText = question => typeof question === 'string' ? question : question.text;
export const plainText = questions => questions.map(question => questionText(question).replace(/\r\n?|\n/g, ' ')).join('\n');
export const validTarget = target => Number.isSafeInteger(target) && target > 0;
