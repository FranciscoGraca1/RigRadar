const INSTRUCTIONS = `És o assistente da app RigRadar. Responde em português de Portugal, de forma breve e concreta. Recebes uma build de PC, preços e avisos produzidos por regras determinísticas. Não declares uma peça compatível quando existe um aviso. Explica o que sabes, o que falta verificar (incluindo BIOS e conectores específicos) e sugere uma alternativa apenas quando os dados apresentados a suportam. Não inventes preços atuais, stocks ou benchmarks.`;

export async function askAssistant({ message, context, fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4.1-mini' }) {
  if (!apiKey || !model) throw new Error('API de IA não configurada.');
  if (typeof message !== 'string' || !message.trim() || message.length > 2_000) throw new Error('Pergunta inválida.');
  if (!context || typeof context !== 'object' || Array.isArray(context) || typeof context.selections !== 'object' || !Array.isArray(context.warnings)) throw new Error('Contexto da build inválido.');
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      model,
      instructions:INSTRUCTIONS,
      input:`Pergunta: ${message.trim()}\n\nBuild: ${JSON.stringify(context)}`,
      max_output_tokens:500,
      store:false
    }),
    signal:AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`A API de IA respondeu com HTTP ${response.status}.`);
  const result = await response.json();
  const answer = result.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!answer) throw new Error('A API de IA não devolveu texto.');
  return answer;
}
