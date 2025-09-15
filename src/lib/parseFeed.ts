// クライアント側で DOMParser を用いて RSS/Atom をパース
import { FeedItem } from "./types";

export function parseFeedXML(xml: string, sourceSlug: string, sourceName: string): FeedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");

    // Atom: <feed><entry>
    const atomEntries = Array.from(doc.getElementsByTagName("entry"));
    if (atomEntries.length) {
      return atomEntries.map((e, idx) => {
        const title = textContent(e, "title") || "(no title)";
        const href = getAtomLink(e) || textContent(e, "id") || "#";
        const published = textContent(e, "updated") || textContent(e, "published") || new Date().toISOString();
        const rawSummary = textContent(e, "summary") || textContent(e, "content") || undefined;
        const excerpt = rawSummary ? stripHtml(rawSummary) : undefined;
        return {
          id: `${sourceSlug}-atom-${idx}-${href}`,
          title,
          url: href,
          publishedAt: new Date(published).toISOString(),
          sourceSlug,
          sourceName,
          group: undefined as any,
          kind: "blog",
          excerpt,
        } as FeedItem;
      });
    }

    // RSS 2.0: <channel><item>
    const rssItems = Array.from(doc.getElementsByTagName("item"));
    if (rssItems.length) {
      return rssItems.map((it, idx) => {
        const title = textContent(it, "title") || "(no title)";
        const link = getRssLink(it) || "#";
        const pub = textContent(it, "pubDate") || new Date().toISOString();
        const desc = textContent(it, "description") || textContentNS(it, "content", "encoded") || undefined;
        return {
          id: `${sourceSlug}-rss-${idx}-${link}`,
          title,
          url: link,
          publishedAt: new Date(pub).toISOString(),
          sourceSlug,
          sourceName,
          group: undefined as any,
          kind: "blog",
          excerpt: desc ? stripHtml(desc) : undefined,
        } as FeedItem;
      });
    }

    return [];
  } catch {
    return [];
  }
}

function textContent(el: Element, tag: string) {
  const n = el.getElementsByTagName(tag)[0];
  return n ? n.textContent?.trim() ?? "" : "";
}

function textContentNS(el: Element, nsTag: string, child: string) {
  // e.g. <content:encoded>
  const kids = Array.from(el.getElementsByTagNameNS("*", child));
  if (kids.length) return kids[0].textContent?.trim() ?? "";
  // fallback search by tagName
  const nodes = Array.from(el.getElementsByTagName(`${nsTag}:${child}`));
  return nodes.length ? nodes[0].textContent?.trim() ?? "" : "";
}

function getAtomLink(entry: Element): string | undefined {
  const links = Array.from(entry.getElementsByTagName("link"));
  const alt = links.find((l) => l.getAttribute("rel") === "alternate");
  return (alt ?? links[0])?.getAttribute("href") ?? undefined;
}

function getRssLink(item: Element): string | undefined {
  // <link>text</link>
  const direct = item.getElementsByTagName("link")[0]?.textContent?.trim();
  if (direct) return direct;
  // <link href="..." /> パターン
  const linkEl = item.getElementsByTagName("link")[0] as Element | undefined;
  const href = linkEl?.getAttribute?.("href");
  if (href) return href;
  // <guid> が URL の場合
  const guid = item.getElementsByTagName("guid")[0]?.textContent?.trim();
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  // namespaced atom:link
  const atomLinks = Array.from(item.getElementsByTagNameNS("*", "link"));
  for (const el of atomLinks) {
    const rel = el.getAttribute("rel");
    if (!rel || rel === "alternate") {
      const u = el.getAttribute("href");
      if (u) return u;
    }
  }
  return undefined;
}

function stripHtml(html: string) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const text = tmp.textContent || tmp.innerText || "";
  return text.slice(0, 280);
}
