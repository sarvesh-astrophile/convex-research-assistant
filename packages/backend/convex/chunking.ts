export function chunkPages(pages: string[]) {
  const words = pages.flatMap((text, page) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ word, page: page + 1 })),
  );
  const chunks: {
    chunkIndex: number;
    text: string;
    tokenCount: number;
    pageStart: number;
    pageEnd: number;
  }[] = [];
  for (let start = 0; start < words.length; start += 380) {
    const window = words.slice(start, start + 450);
    if (!window.length) break;
    chunks.push({
      chunkIndex: chunks.length,
      text: window.map(({ word }) => word).join(" "),
      tokenCount: Math.ceil(window.length * 1.4),
      pageStart: window[0].page,
      pageEnd: window[window.length - 1].page,
    });
    if (start + 450 >= words.length) break;
  }
  return chunks;
}
