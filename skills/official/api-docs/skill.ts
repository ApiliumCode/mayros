/**
 * api-docs — semantic skill runtime
 *
 * Enriches API queries with compact, multi-language SDK code snippets
 * for common Anthropic API operations.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// Snippet catalog: operation -> language -> code
// ---------------------------------------------------------------------------

type SnippetMap = Record<string, Record<string, string>>;

const SNIPPETS: SnippetMap = {
  messages: {
    python: `response = client.messages.create(
    model="claude-sonnet-4-6-20250514", max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}])`,
    typescript: `const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});`,
    java: `Message message = client.messages().create(MessageCreateParams.builder()
    .model("claude-sonnet-4-6-20250514").maxTokens(1024)
    .addUserMessage("Hello").build());`,
    go: `resp, _ := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
    Model: anthropic.F("claude-sonnet-4-6-20250514"), MaxTokens: anthropic.Int(1024),
    Messages: anthropic.F([]anthropic.MessageParam{{Role: "user", Content: "Hello"}})})`,
    ruby: `response = client.messages(
  model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }])`,
    php: `$response = $client->messages()->create([
    'model' => 'claude-sonnet-4-6-20250514', 'max_tokens' => 1024,
    'messages' => [['role' => 'user', 'content' => 'Hello']]]);`,
    csharp: `var response = await client.Messages.CreateAsync(new MessageRequest {
    Model = "claude-sonnet-4-6-20250514", MaxTokens = 1024,
    Messages = new[] { new Message { Role = "user", Content = "Hello" } }});`,
  },
  streaming: {
    python: `with client.messages.stream(
    model="claude-sonnet-4-6-20250514", max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]) as stream:
    for text in stream.text_stream: print(text, end="")`,
    typescript: `const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
for await (const event of stream) { process.stdout.write(event.type); }`,
    java: `client.messages().createStreaming(params).stream()
    .filter(e -> e.type().equals("content_block_delta"))
    .forEach(e -> System.out.print(e.delta().text()));`,
    go: `stream := client.Messages.NewStreaming(ctx, params)
for stream.Next() { event := stream.Current(); fmt.Print(event) }`,
    ruby: `client.messages(params) do |event|
  print event.content if event.type == "content_block_delta"
end`,
    php: `$stream = $client->messages()->createStreamed($params);
foreach ($stream as $event) { echo $event['delta']['text'] ?? ''; }`,
    csharp: `await foreach (var ev in client.Messages.CreateStreamAsync(request)) {
    Console.Write(ev.Delta?.Text ?? ""); }`,
  },
  tool_use: {
    python: `response = client.messages.create(
    model="claude-sonnet-4-6-20250514", max_tokens=1024,
    tools=[{"name": "get_weather", "description": "Get weather",
            "input_schema": {"type": "object", "properties": {"location": {"type": "string"}}}}],
    messages=[{"role": "user", "content": "Weather in London?"}])`,
    typescript: `const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
  tools: [{ name: "get_weather", description: "Get weather",
    input_schema: { type: "object", properties: { location: { type: "string" } } } }],
  messages: [{ role: "user", content: "Weather in London?" }],
});`,
    java: `Message msg = client.messages().create(MessageCreateParams.builder()
    .model("claude-sonnet-4-6-20250514").maxTokens(1024)
    .addTool(Tool.builder().name("get_weather").description("Get weather")
      .inputSchema(schema).build())
    .addUserMessage("Weather in London?").build());`,
    go: `resp, _ := client.Messages.New(ctx, anthropic.MessageNewParams{
    Model: anthropic.F("claude-sonnet-4-6-20250514"), MaxTokens: anthropic.Int(1024),
    Tools: anthropic.F([]anthropic.ToolParam{{Name: "get_weather",
      Description: "Get weather", InputSchema: schema}}),
    Messages: anthropic.F(msgs)})`,
    ruby: `response = client.messages(model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
  tools: [{ name: "get_weather", description: "Get weather",
    input_schema: { type: "object", properties: { location: { type: "string" } } } }],
  messages: [{ role: "user", content: "Weather in London?" }])`,
  },
  vision: {
    python: `response = client.messages.create(
    model="claude-sonnet-4-6-20250514", max_tokens=1024,
    messages=[{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64",
         "media_type": "image/png", "data": img_b64}},
        {"type": "text", "text": "Describe this image"}]}])`,
    typescript: `const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
  messages: [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/png", data: imgB64 } },
    { type: "text", text: "Describe this image" }] }],
});`,
    java: `Message msg = client.messages().create(MessageCreateParams.builder()
    .model("claude-sonnet-4-6-20250514").maxTokens(1024)
    .addUserMessageOfBlockParams(List.of(
        ImageBlockParam.of(Base64ImageSource.of("image/png", imgB64)),
        TextBlockParam.of("Describe this image"))).build());`,
    go: `resp, _ := client.Messages.New(ctx, anthropic.MessageNewParams{
    Model: anthropic.F("claude-sonnet-4-6-20250514"), MaxTokens: anthropic.Int(1024),
    Messages: anthropic.F([]anthropic.MessageParam{{Role: "user",
      Content: []anthropic.ContentBlock{
        {Type: "image", Source: &anthropic.ImageSource{Type: "base64", Data: imgB64}},
        {Type: "text", Text: "Describe this image"}}}})})`,
  },
  batch: {
    python: `batch = client.beta.messages.batches.create(requests=[
    {"custom_id": "req-1", "params": {
        "model": "claude-sonnet-4-6-20250514", "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Summarize..."}]}}])`,
    typescript: `const batch = await anthropic.beta.messages.batches.create({
  requests: [{ custom_id: "req-1", params: {
    model: "claude-sonnet-4-6-20250514", max_tokens: 1024,
    messages: [{ role: "user", content: "Summarize..." }] } }],
});`,
    java: `BatchCreateResponse batch = client.beta().messages().batches()
    .create(BatchCreateParams.builder().addRequest(
        BatchRequest.builder().customId("req-1")
        .params(params).build()).build());`,
    go: `batch, _ := client.Beta.Messages.Batches.New(ctx, anthropic.BatchNewParams{
    Requests: anthropic.F([]anthropic.BatchRequest{{CustomID: "req-1", Params: params}})})`,
  },
  embeddings: {
    python: `response = client.embeddings.create(
    model="claude-embed-1", input=["Hello, world!"])`,
    typescript: `const response = await anthropic.embeddings.create({
  model: "claude-embed-1", input: ["Hello, world!"],
});`,
    java: `EmbeddingResponse resp = client.embeddings().create(
    EmbeddingCreateParams.builder()
    .model("claude-embed-1").addInput("Hello, world!").build());`,
    go: `resp, _ := client.Embeddings.New(ctx, anthropic.EmbeddingNewParams{
    Model: anthropic.F("claude-embed-1"),
    Input: anthropic.F([]string{"Hello, world!"})})`,
  },
};

// ---------------------------------------------------------------------------
// Detection maps
// ---------------------------------------------------------------------------

const OPERATION_KEYWORDS: Record<string, string[]> = {
  messages: ["message", "messages", "create", "send", "chat", "completion"],
  streaming: ["stream", "streaming", "sse", "server-sent", "real-time", "realtime"],
  tool_use: ["tool", "tools", "function", "function_call", "tool_use", "function calling"],
  vision: ["vision", "image", "picture", "photo", "visual", "multimodal", "base64"],
  batch: ["batch", "bulk", "parallel", "queue", "async requests"],
  embeddings: ["embed", "embedding", "embeddings", "vector", "similarity"],
};

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  python: ["python", "py", "pip", "django", "flask", "fastapi"],
  typescript: ["typescript", "ts", "javascript", "js", "node", "deno", "bun", "npm"],
  java: ["java", "jvm", "maven", "gradle", "spring"],
  go: ["go", "golang"],
  ruby: ["ruby", "rb", "rails", "gem"],
  php: ["php", "laravel", "composer"],
  csharp: ["csharp", "c#", ".net", "dotnet", "nuget"],
};

const DEFAULT_LANGUAGES = ["python", "typescript"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(results: Array<{ subject: string; object: unknown }>): string {
  return results
    .map((r) => {
      const subj = r.subject;
      const obj = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      return `${subj} ${obj}`;
    })
    .join(" ")
    .toLowerCase();
}

function detectOperations(text: string): string[] {
  const detected: string[] = [];
  for (const [op, keywords] of Object.entries(OPERATION_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        detected.push(op);
        break;
      }
    }
  }
  return detected.length > 0 ? detected : ["messages"];
}

function detectLanguages(text: string): string[] {
  const detected: string[] = [];
  for (const [lang, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        detected.push(lang);
        break;
      }
    }
  }
  return detected.length > 0 ? detected : DEFAULT_LANGUAGES;
}

function gatherSnippets(
  operations: string[],
  languages: string[],
): Array<{ operation: string; language: string; code: string }> {
  const collected: Array<{ operation: string; language: string; code: string }> = [];
  for (const op of operations) {
    const opSnippets = SNIPPETS[op];
    if (!opSnippets) continue;
    for (const lang of languages) {
      const code = opSnippets[lang];
      if (code) {
        collected.push({ operation: op, language: lang, code });
      }
    }
  }
  return collected;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "api-docs",

  async onActivate(ctx) {
    ctx.logger.info(`api-docs: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    const text = extractText(ctx.results);
    const operations = detectOperations(text);
    const languages = detectLanguages(text);
    const snippets = gatherSnippets(operations, languages);

    if (snippets.length === 0) {
      return {
        results: ctx.results,
        additionalContext:
          "[api-docs] No matching snippets found for the detected operation and language.",
      };
    }

    const enriched = ctx.results.map((r) => ({
      subject: r.subject,
      object: {
        original: r.object,
        snippets: snippets.map((s) => ({
          operation: s.operation,
          language: s.language,
          code: s.code,
        })),
      },
    }));

    const opList = [...new Set(snippets.map((s) => s.operation))].join(", ");
    const langList = [...new Set(snippets.map((s) => s.language))].join(", ");

    return {
      results: enriched,
      additionalContext: `[api-docs] Found ${snippets.length} snippets for ${opList} in ${langList}`,
    };
  },
};

export default runtime;
