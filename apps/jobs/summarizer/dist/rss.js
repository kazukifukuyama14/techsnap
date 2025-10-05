"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchFeedItems = fetchFeedItems;
const rss_parser_1 = __importDefault(require("rss-parser"));
const parser = new rss_parser_1.default();
async function fetchFeedItems(feedUrl, limit) {
    try {
        const feed = await parser.parseURL(feedUrl);
        return (feed.items || [])
            .slice(0, limit)
            .map((item) => ({
            feedUrl,
            title: item.title || "(untitled)",
            link: item.link || "",
            publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
            content: item.contentSnippet || item.content || "",
        }))
            .filter((item) => item.link);
    }
    catch (error) {
        console.error(`[summarizer] failed to fetch RSS feed: ${feedUrl}`, error);
        return [];
    }
}
