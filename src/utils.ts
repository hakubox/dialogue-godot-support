
/**
 * 生成指定位数十六进制唯一 ID
 * 示例：4A2E23B21C7C
 */
export function generateDialogueID(len = 10): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < len; i++) {
    id += chars[Math.floor(Math.random() * 36)];
  }
  return id;
}