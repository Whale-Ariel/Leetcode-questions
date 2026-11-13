import { el } from "./api.js?v=25";
import { renderMarkdown } from "./markdown.js?v=25";
import { highlightCodeBlocks } from "./highlight.js?v=25";

// 渲染题干 Markdown 为消毒后的文章节点；图片离线不可见时给出链接占位
export function statementArticle(markdown) {
  const article = el("article", "statement markdown-body");
  article.innerHTML = renderMarkdown(markdown);
  highlightCodeBlocks(article);
  article.querySelectorAll("img").forEach((img) => {
    const url = img.getAttribute("src");
    const link = el("a", "img-fallback", `图片需联网查看：${url}`);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    img.addEventListener("error", () => img.replaceWith(link));
    if (img.complete && img.naturalWidth === 0) img.replaceWith(link);
  });
  return article;
}
