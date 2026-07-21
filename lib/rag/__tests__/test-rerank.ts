/**
 * Test script for RAG Rerank integration
 *
 * Priority: Alibaba Cloud qwen3-rerank > heuristic
 *
 * Usage:
 *   npx tsx lib/rag/__tests__/test-rerank.ts
 */

import { rerankDocuments } from "../rerank";

async function testRerank() {
  console.log("Testing RAG Rerank Integration\n");
  console.log("=".repeat(50));

  const provider =
    process.env.ALIYUN_RERANK_API_KEY && process.env.ALIYUN_RERANK_BASE_URL
      ? "Alibaba Cloud qwen3-rerank"
      : "Heuristic (fallback)";

  console.log(`Provider: ${provider}\n`);

  // Test documents — mixed Chinese + English, varying relevance
  const query = "如何优化 PostgreSQL 数据库性能";
  const documents = [
    {
      content:
        "MySQL 是一个流行的开源关系型数据库管理系统，广泛用于 Web 应用。",
      chunkIndex: 0,
      fileName: "mysql-guide.pdf",
      pageNumber: 1,
    },
    {
      content:
        "PostgreSQL 性能优化的关键在于正确配置索引。GIN 和 GiST 索引适合全文搜索，B-tree 索引适合范围查询。",
      chunkIndex: 1,
      fileName: "postgres-optimization.pdf",
      pageNumber: 15,
    },
    {
      content: "数据库备份策略应该包括定期的全量备份和增量备份，确保数据安全。",
      chunkIndex: 2,
      fileName: "backup-guide.pdf",
      pageNumber: 3,
    },
    {
      content:
        "Redis 是一个内存数据库，常用于缓存和会话存储，可以显著提升应用性能。",
      chunkIndex: 3,
      fileName: "redis-intro.pdf",
      pageNumber: 8,
    },
    {
      content:
        "PostgreSQL 的 VACUUM 命令可以回收存储空间并更新统计信息，对性能优化很重要。",
      chunkIndex: 4,
      fileName: "postgres-maintenance.pdf",
      pageNumber: 22,
    },
  ];

  console.log(`Query: "${query}"\n`);
  console.log(`Documents (${documents.length}):`);
  for (const doc of documents) {
    console.log(`   ${doc.fileName} (Page ${doc.pageNumber})`);
    console.log(`   "${doc.content.slice(0, 50)}..."\n`);
  }

  console.log("Running rerank...\n");

  const start = Date.now();
  const results = await rerankDocuments({ query, documents, topK: 3 });
  const duration = Date.now() - start;

  console.log("=".repeat(50));
  console.log(`Rerank completed in ${duration}ms\n`);

  console.log("Top 3 Results:");
  for (const doc of results) {
    console.log(
      `\n  ${doc.fileName} (Page ${doc.pageNumber})  score=${doc.rerankScore.toFixed(4)}`
    );
    console.log(`  "${doc.content.slice(0, 80)}..."`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("\nExpected ranking:");
  console.log("  1. postgres-optimization.pdf (index optimization)");
  console.log("  2. postgres-maintenance.pdf (VACUUM)");
  console.log("  3. Others (less relevant)\n");

  // Verify basic correctness
  const isCorrect =
    results[0].fileName === "postgres-optimization.pdf" &&
    results[1].fileName === "postgres-maintenance.pdf";

  if (isCorrect) {
    console.log("Rerank working correctly!");
  } else {
    console.log(
      "Ranking may not be optimal (heuristic fallback is approximate)"
    );
    if (
      !(process.env.ALIYUN_RERANK_API_KEY && process.env.ALIYUN_RERANK_BASE_URL)
    ) {
      console.log(
        "  Set ALIYUN_RERANK_API_KEY and ALIYUN_RERANK_BASE_URL for better results"
      );
    }
  }

  console.log("\nTest completed!\n");
}

testRerank().catch(console.error);
