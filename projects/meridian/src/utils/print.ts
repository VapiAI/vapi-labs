export function pretty(label: string, data: unknown) {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(data, null, 2));
}

export function header(title: string) {
  const line = "─".repeat(title.length + 4);
  console.log(`\n${line}\n  ${title}\n${line}`);
}
