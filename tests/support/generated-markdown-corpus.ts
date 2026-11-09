export interface GoodMarkdownSample {
  name: string
  source: string
  selectors: string[]
  text: string[]
  citations?: number
}

export interface MixedMarkdownSample extends GoodMarkdownSample {
  refused: string
}

/** Model-style content that must render richly at both sinks, with two sources available in chat. */
export const goodMarkdownCorpus: GoodMarkdownSample[] = [
  { name: 'lesson overview', source: '## Photosynthesis\n\nPlants convert **light** into *chemical* energy [1].\n\n- Light reactions\n- Calvin cycle [2]', selectors: ['h2', 'strong', 'em', 'ul li'], text: ['Plants convert', 'Calvin cycle'], citations: 2 },
  { name: 'three-level list with bold', source: '- **Cells**\n  - **Organelles**\n    - **Nucleus** holds DNA\n    - **Ribosome** builds proteins', selectors: ['ul ul ul li', 'ul ul ul strong'], text: ['Nucleus', 'builds proteins'] },
  { name: 'four-level plain list', source: '- One\n  - Two\n    - Three\n      - Four', selectors: ['ul ul ul ul li'], text: ['Four'] },
  { name: 'six-level list with a bold link', source: '- a\n  - b\n    - c\n      - d\n        - e\n          - **[Read](https://example.invalid/notes)**', selectors: ['ul ul ul ul ul ul strong a'], text: ['Read'] },
  { name: 'ordered list starting at zero', source: '0. Zeroth law\n1. First law\n2. Second law', selectors: ['ol[start="0"] li'], text: ['Zeroth law'] },
  { name: 'ordered list starting later', source: '3. Third step\n4. Fourth step', selectors: ['ol[start="3"] li'], text: ['Fourth step'] },
  { name: 'mixed nested lists', source: '1. Prepare\n   - Gather **tools**\n   - Read the *guide*\n2. Build\n\n   A second paragraph in the item.', selectors: ['ol ul li', 'ol strong', 'ol em', 'ol li p'], text: ['second paragraph'] },
  { name: 'table with alignment', source: '| Topic | Score | Grade |\n|:---|---:|:--:|\n| Algebra | 90 | A |\n| Biology | 75 | **B** |', selectors: ['th.text-left\\!', 'th.text-right\\!', 'th.text-center\\!', 'td.text-left\\!', 'td.text-right\\!', 'td.text-center\\! strong'], text: ['Algebra', 'Biology'] },
  { name: 'table with code and citations', source: '| Term | Meaning |\n|---|---|\n| `Map<K, V>` | Key lookup [1] |\n| x < y | Comparison [2] |', selectors: ['table th', 'td code'], text: ['Map<K, V>', 'x < y'], citations: 2 },
  { name: 'math with subscript braces', source: 'The index is $x_{i}$ and the total is $\\sum_{i=1}^{n} x_{i}$ [1].', selectors: ['p'], text: ['$x_{i}$', '$\\sum_{i=1}^{n} x_{i}$'], citations: 1 },
  { name: 'math beside formatting', source: 'For **every** term, x_{i} grows and *each* y_{j} shrinks.', selectors: ['strong', 'em'], text: ['x_{i} grows', 'y_{j} shrinks'] },
  { name: 'math without bare groups', source: 'Energy is $E = mc^2$, with a_1 + b_2 and x^{2} and x_{i+1} and f(x) = {x}.', selectors: ['p'], text: ['$E = mc^2$', 'x^{2}', 'x_{i+1}', '{x}'] },
  { name: 'set notation', source: 'Let **S** be {1, 2, 3} and T be {a, b}. The empty set is {} here [1].', selectors: ['strong'], text: ['{1, 2, 3}', '{a, b}', '{}'], citations: 1 },
  { name: 'object in prose', source: 'Send a body like {"name": "value"} to the server, then read { ok: true } back.', selectors: ['p'], text: ['{"name": "value"}', '{ ok: true }'] },
  { name: 'comparison signs', source: 'For x < y, choose y [1]. If a > b and c >= d, stop. Note 3 < 5 and 5 > 3 [2].', selectors: ['p'], text: ['x < y', 'a > b', 'c >= d', '3 < 5'], citations: 2 },
  { name: 'arrows in prose', source: 'Flow: A -> B => C <- D, then **done**.', selectors: ['strong'], text: ['A -> B => C <- D'] },
  { name: 'inline code with angle brackets', source: 'Use `Array<string>` or `<div class="note">` but keep `[1]` literal [1].', selectors: ['code'], text: ['Array<string>', '<div class="note">', '[1]'], citations: 1 },
  { name: 'blockquotes with citations', source: '> Quoted fact [1].\n>\n> > Nested **fact** [2].', selectors: ['blockquote blockquote strong'], text: ['Quoted fact'], citations: 2 },
  { name: 'emoji and non-Latin text', source: 'Great job 🎉 — naïve 光合作用 ✅ :) **Größe**', selectors: ['strong'], text: ['🎉', '光合作用', '✅', ':)'] },
  { name: 'entities', source: 'AT&amp;T shows &lt;tag&gt; text, &copy; 2026 and &#123;x&#125; with **care**.', selectors: ['strong'], text: ['AT&T', '<tag>', '©', '{x}'] },
  { name: 'links', source: 'See [the guide](https://example.invalid/guide "Guide"), <https://example.invalid/auto> and https://example.invalid/bare.', selectors: ['a[href="https://example.invalid/guide"]', 'a[href="https://example.invalid/auto"]', 'a[href="https://example.invalid/bare"]'], text: ['the guide'] },
  { name: 'reference links', source: 'Read [the guide][g] first.\n\n[g]: https://example.invalid/guide', selectors: ['a[href="https://example.invalid/guide"]'], text: ['the guide'] },
  { name: 'fenced code in several languages', source: '```ts\nconst list: Array<number> = [1]\n```\n\n```python\nprint({"a": 1})\n```\n\n```bash\necho "<ok>"\n```\n\n```json\n{ "a": [1] }\n```\n\n```rust\nlet a = vec![1];\n```', selectors: ['pre code'], text: ['Array<number>', 'print({"a": 1})', 'echo "<ok>"', '{ "a": [1] }', 'vec![1]'] },
  { name: 'indented code', source: 'Run this:\n\n    <kept literal> {x} [1]\n\nThen **stop**.', selectors: ['pre code', 'strong'], text: ['<kept literal> {x} [1]'] },
  { name: 'hard breaks and rules', source: 'Line one  \nLine two\n\n---\n\n# Top\n\n###### Small', selectors: ['br', 'hr', 'h2', 'h6'], text: ['Line one', 'Line two'] },
  { name: 'strikethrough and subscript tildes', source: '~~Old claim~~ replaced. Water is H~2~O and ~5 is close to ~10.', selectors: ['del'], text: ['Old claim', 'H~2~O', '~5', '~10'] },
  { name: 'emphasis variations', source: '***Both*** and _under_ and __strong__ with snake_case_name and 2 * 3 * 4.', selectors: ['em', 'strong'], text: ['snake_case_name', '2 * 3 * 4'] },
  { name: 'historical citation forms', source: 'One [Source 1: notes.pdf], two (Source 2), three Source 1.', selectors: ['p'], text: ['One', 'two', 'three'], citations: 3 },
  { name: 'colons, times and brackets', source: 'Ratio 3:1 at 12:30. Key: value. Note [draft] uses arr[0] and [1, 2] :smile: today.', selectors: ['p'], text: ['3:1', '12:30', '[draft]', 'arr[0]', '[1, 2]', '😄'] },
]

/** One refused block among good ones. Only that block may degrade. */
export const mixedMarkdownCorpus: MixedMarkdownSample[] = [
  { name: 'raw HTML paragraph', source: '## Keep\n\nGood **intro**.\n\nInline <b>markup</b> here [1].\n\n- Good item', refused: 'Inline <b>markup</b> here [1].', selectors: ['h2', 'strong', 'ul li'], text: ['Good item'] },
  { name: 'HTML block', source: 'Good **intro**.\n\n<div title="canary">\nReadable canary\n</div>\n\n| A |\n|---|\n| B |', refused: '<div title="canary">\nReadable canary\n</div>', selectors: ['strong', 'table td'], text: ['B'] },
  { name: 'image', source: '# Keep\n\n![Readable canary](https://example.invalid/image.png)\n\n*Good* outro.', refused: '![Readable canary](https://example.invalid/image.png)', selectors: ['h2', 'em'], text: ['outro'] },
  { name: 'relative link', source: 'Good **intro**.\n\nSee [the page](/app/private) now.\n\n> Good quote', refused: 'See [the page](/app/private) now.', selectors: ['strong', 'blockquote'], text: ['Good quote'] },
  { name: 'component directive', source: 'Good **intro**.\n\n::generated-canary\nReadable canary\n::\n\nGood *outro*.', refused: '::generated-canary\nReadable canary\n::', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'brace group beside a link', source: 'Good **intro**.\n\n[Readable canary](https://example.invalid){@click="canary"} text.\n\nGood *outro*.', refused: '[Readable canary](https://example.invalid){@click="canary"} text.', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'inline attribute', source: '- Good item\n\nReadable **canary**{.canary #canary} text.\n\n`good code`', refused: 'Readable **canary**{.canary #canary} text.', selectors: ['ul li', 'code'], text: ['good code'] },
  { name: 'attribute form on a text node', source: 'Good **intro**.\n\nReadable x_{.canary} text.\n\nGood *outro*.', refused: 'Readable x_{.canary} text.', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'binding', source: 'Good **intro**.\n\nValue {{ canary.value }} here.\n\nGood *outro*.', refused: 'Value {{ canary.value }} here.', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'task list', source: 'Good **intro**.\n\n- [ ] Read the chapter\n- [x] Take notes\n\nGood *outro*.', refused: '- [ ] Read the chapter\n- [x] Take notes', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'fence options', source: 'Good **intro**.\n\n```text {title="canary"}\nReadable canary\n```\n\nGood *outro*.', refused: '```text {title="canary"}\nReadable canary\n```', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'footnote definition', source: 'Good **intro**.\n\n[^n]: A note.\n\nGood *outro*.', refused: '[^n]: A note.', selectors: ['strong', 'em'], text: ['outro'] },
  { name: 'pathological nesting', source: `Good **intro**.\n\n${'> '.repeat(30)}Readable canary\n\nGood *outro*.`, refused: `${'> '.repeat(30)}Readable canary`, selectors: ['strong', 'em'], text: ['outro'] },
]
