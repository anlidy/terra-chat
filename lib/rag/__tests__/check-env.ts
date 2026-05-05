/**
 * Environment variable checker for RAG features
 *
 * Usage: npx tsx lib/rag/__tests__/check-env.ts
 */

function checkEnv() {
  console.log("🔍 Checking RAG Environment Configuration\n");
  console.log("=".repeat(60));

  const checks = [
    {
      name: "Database",
      key: "POSTGRES_URL",
      required: true,
      description: "PostgreSQL database connection",
    },
    {
      name: "LlamaCloud",
      key: "LLAMA_CLOUD_API_KEY",
      required: true,
      description: "Document parsing (PDF, DOCX, etc.)",
    },
    {
      name: "Zhipu AI",
      key: "ZHIPU_API_KEY",
      required: true,
      description: "Text embedding (vector search)",
    },
    {
      name: "DashScope Rerank",
      key: "DASHSCOPE_API_KEY",
      required: false,
      description: "Reranking via gte-rerank",
    },
  ];

  let allRequired = true;
  let hasOptional = false;

  for (const check of checks) {
    const value = process.env[check.key];
    const isSet = !!value;
    const status = isSet ? "✅" : check.required ? "❌" : "⚠️ ";

    console.log(`\n${status} ${check.name}`);
    console.log(`   Key: ${check.key}`);
    console.log(`   Status: ${isSet ? "Configured" : "Not configured"}`);
    console.log(`   Required: ${check.required ? "Yes" : "No (optional)"}`);
    console.log(`   Purpose: ${check.description}`);

    if (isSet) {
      const preview = `${value.slice(0, 10)}...`;
      console.log(`   Value: ${preview}`);
    } else if (check.required) {
      allRequired = false;
      console.log(`   ⚠️  Add to .env.local: ${check.key}=your_key`);
    } else {
      console.log("   💡 Optional: Add for better results");
    }

    if (!check.required && isSet) {
      hasOptional = true;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("\n📊 Summary:\n");

  if (allRequired) {
    console.log("✅ All required environment variables are configured");
  } else {
    console.log("❌ Missing required environment variables");
    console.log("   Please add them to .env.local");
  }

  if (hasOptional) {
    console.log("✅ Optional features enabled (Rerank)");
  } else {
    console.log("⚠️  Optional features not enabled");
    console.log("   Add DASHSCOPE_API_KEY for better reranking");
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("\n📚 Next Steps:\n");

  if (allRequired) {
    console.log("1. Run database migrations: pnpm db:migrate");
    console.log("2. Test rerank: npx tsx lib/rag/__tests__/test-rerank.ts");
    console.log("3. Upload a document and test RAG features");
  } else {
    console.log("1. Copy .env.example to .env.local");
    console.log("2. Fill in the required API keys");
    console.log("3. Restart the application");
  }

  if (!hasOptional) {
    console.log("\n💡 To enable DashScope Rerank:");
    console.log("   1. Visit https://dashscope.console.aliyun.com/");
    console.log("   2. Sign up and get API key");
    console.log("   3. Add to .env.local: DASHSCOPE_API_KEY=your_key");
    console.log("   4. Restart application");
  }

  console.log("\n📖 Documentation:");
  console.log("   - Full Guide: lib/rag/README.md");

  console.log("\n");

  // Exit code
  process.exit(allRequired ? 0 : 1);
}

checkEnv();
