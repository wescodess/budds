# Evidence for a "learn anything" void in Budds

Date: 2026-11-04
Status: Research input for a product decision; no implementation has changed

Tags: **[strong]** replicated or meta-analytic, or a large peer-reviewed RCT. **[moderate]** smaller peer-reviewed trial, or a meta-analysis with real caveats. **[weak/preprint]** preprint, working paper or observational. **[vendor]** authored by the party selling the system. "Inference" marks my reading, not a source's finding.

## Bottom line

- **Do not build learning-style matching.** The newest meta-analysis finds crossover support in only 26% of outcomes, and its authors call the benefit too small and infrequent to adopt. Answer "know how I learn" with a different model.
- **Adapt to prior knowledge first.** This has the best adaptation evidence, so the fixed 10-block loop should become conditional.
- **Vary practice, not the clock.** A typical learner needs about 7 opportunities per knowledge component: about 13 in the lower half, 4 in the upper half. Learning rates are similar; starting points are not.
- **Do not promise two sigma.** Later estimates are d = 0.79 for human tutoring and 0.37 SD across tutoring experiments. AI tutor classroom trials here range from 0.63 SD in one Harvard course to -0.37 SD.
- **Grounding alone is not a learning guardrail.** A randomized trial of a RAG tutor on instructor-selected materials found final grades 0.27 to 0.37 SD lower. Grounding protects accuracy; structure protects learning.
- **Put structure in code.** Positive results share enforced sequences, verified solutions in the prompt, and usually a teacher or tutor. Answer withholding prevents harm but does not create gain.
- **Never gate on how learning feels.** Students repeatedly misjudge it, including failing to notice harm from a tool. Only unassisted, delayed performance should change state.
- **"Retained" needs more than one check.** The best prescriptive evidence is 3 correct recalls, then 3 widely spaced relearning sessions.
- **Keep the learner model simple.** Use a per-objective Bayesian or Elo-style estimate plus default-parameter FSRS. Skip deep knowledge tracing; shadow-test LLM estimates.
- **Default to a typed component catalogue, with sandboxed generated HTML as a bounded escape hatch.** I found no controlled evidence that LLM-generated interactive UI improves learning.
- **Replace the model-memory ban with labelled provenance tiers, keeping assessment keys source-bound.** I found no production system documenting this learner-facing tiering, so it is a proposal.

## 1. Learning styles

**Meshing.** Pashler et al. require a crossover: each style must do best with its own method on the same test. They found "no adequate evidence base," while noting many variants were never tested ([Pashler 2008](https://pubmed.ncbi.nlm.nih.gov/26162104/)) [strong]. College-educated adults showed no style-by-method relationship for audiobook versus e-text, immediately or after 2 weeks ([Rogowsky 2015](https://eric.ed.gov/?id=EJ1055886)) [moderate]. In 5th graders (N = 136; 34 in the categorical analysis), the interaction was F(1, 38) = 1.16, p = 0.29 ([Rogowsky 2020](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.00164/full)) [moderate].

**Latest meta-analysis.** 21 studies, 1,712 participants: g = 0.31, CI [0.05, 0.57], but only 26% of outcomes showed a crossover, and study quality was low ([Clinton-Lisell & Litzinger 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11270031/)) [strong]. I found no randomized trial of an LLM tutor adapting to styles; the nearest work only tests [whether LLMs can classify them](https://open.clemson.edu/all_dissertations/4230/).

**Why people believe it.** Style preference predicted judgements of learning but not recall ([Knoll 2017](https://pubmed.ncbi.nlm.nih.gov/27620075/)) [moderate]. Active learners learned more yet felt they learned less ([Deslauriers 2019](https://pubmed.ncbi.nlm.nih.gov/31484770/)) [moderate]. Learner control in educational technology averaged g = 0.05 ([Karich 2014](https://eric.ed.gov/?id=EJ1034262)) [moderate].

**What replaces it.**
- *Expertise reversal.* Support that helps novices can hurt advanced learners, consistent with aptitude-treatment work ([Kalyuga 2007](https://eric.ed.gov/?id=EJ785056)) [strong]. A 2025 meta-analysis reports d = 0.505 for novices with more assistance and d = -0.428 for high-prior-knowledge learners, from 60 studies ([Tetzlaff 2025](https://doi.org/10.1016/j.learninstruc.2025.102142), numbers via [a secondary summary](https://www.learningandthebrain.com/blog/one-size-doesnt-fit-all-teaching-experts-and-novices/)) [moderate until checked]. Adaptively faded prompts beat permanent ones over a term ([Nückles 2010](https://eric.ed.gov/?id=EJ880291)) [moderate].
- *Multimedia and dual channels.* Verbal and visual channels are universal architecture, not a personal type ([Mayer 2024](https://eric.ed.gov/?id=EJ1407410)) [strong]. 29 reviews (78,177 participants) support contiguity, signalling, modality, coherence and segmentation ([Noetel 2021](https://doi.org/10.3102/00346543211052329)) [strong].
- *Interest personalization.* g = 0.55 on interest, 0.48 on retention (larger in quasi-experiments), 0.36 on transfer, from 34 publications ([Lin 2024](https://eric.ed.gov/?id=EJ1435667)) [moderate]. Algebra I students (n = 145) kept an equation-writing advantage after treatment ended ([Walkington 2013](https://eric.ed.gov/?id=EJ1054444)) [moderate]. 521 seventh graders preferred narrower personalization than teachers produced with ChatGPT ([Walkington 2026](https://arxiv.org/abs/2602.15876)) [weak/preprint].

| Expectation | Verdict | Budds response |
| --- | --- | --- |
| "You're a visual learner" | Myth | Do not assess, store or display it |
| Format fits the content | Supported | Choose by objective, for everyone |
| Support fades as you improve | Supported | Adapt from attempts, per objective |
| Examples use your interests | Supported, weaker on transfer | Offer, keeping structure unchanged |
| You pick a format | Safe, little learning gain | Allow; never let it skip retrieval |
| Budds learns which format works for you | Untested | Hypothesis only; signals likely too noisy (inference) |

Wording (inference): show "how you're learning" as what you know, the evidence behind it, your interests, schedule and accessibility needs. If asked, say plainly that style matching does not hold up and adapting to knowledge does.

## 2. Mastery learning and tutoring

**Two sigma.** [Bloom 1984](https://eric.ed.gov/?id=EJ303699) rests mainly on two dissertations. Von Hippel finds narrow tests over three weeks, with extra testing and instruction bundled into tutoring, and mastery learning alone at about 1.1 SD ([von Hippel 2024](https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science-fact/)) [moderate]. Later: human tutoring d = 0.79, intelligent tutoring d = 0.76 ([VanLehn 2011](https://eric.ed.gov/?id=EJ946764)) [strong]; median 0.66 SD across 50 tutor evaluations, heavily dependent on local versus standardized tests ([Kulik & Fletcher 2016](https://eric.ed.gov/?id=EJ1090502)) [strong]; 0.37 SD across preK-12 tutoring ([Nickow 2020](https://www.nber.org/papers/w27476)) [strong]. Mastery programs were positive across 108 evaluations ([Kulik 1990](https://eric.ed.gov/?id=EJ415887)) [strong]; [Nintil](https://nintil.com/bloom-sigma/) reports 0.08 on standardized tests from that paper, unconfirmed.

**Learning rate.** Across 1.3 million observations in 27 datasets, initial accuracy varied (about 55% versus 75%) while learning rate was strikingly similar, about 2.5% per opportunity. Reaching 80% takes about 7 opportunities: 13.13 for the lower half, 3.66 for the upper ([Koedinger 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10068755/)) [strong]. These were instrumented courses with error feedback, so generated topics may differ. [KLI](https://pubmed.ncbi.nlm.nih.gov/22486653/) separates fluency, induction and sense-making events with different optimal instruction [moderate].

**Thresholds.** I found nothing validating an 80% LLM-scored rubric as a mastery gate. BKT systems often use 0.95, and observational data favour 0.98 ([Zhang 2025](https://educationaldatamining.org/edm2025/proceedings/2025.EDM.short-papers.4/2025.EDM.short-papers.4.pdf)) [weak/preprint]. An A/B test found less forgetting at a higher threshold, shrinking over time ([JEDM](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/900)) [moderate]. In more than 6,000 middle schoolers, three-correct-in-a-row raised attainment but did not itself improve delayed learning ([Oreopoulos 2026](https://edworkingpapers.com/sites/default/files/ai26-1552.pdf)) [weak/preprint].

**Structures.** ALEKS locates a state in 25 to 30 adaptive questions ([ALEKS](https://www.aleks.com/about_aleks/knowledge_space_theory)) [vendor], but syntheses find g = 0.05, CI [-0.01, 0.20] against traditional instruction, and 0.43 as a supplement ([Sun 2021](https://eric.ed.gov/?id=EJ1314175)) [moderate]. Efficient diagnosis does not itself deliver learning. Math Academy uses prerequisite gating, fine knowledge points and worked examples then practice ([pedagogy](https://www.mathacademy.com/pedagogy)); its FIRe scheduler flows review credit down an expert-maintained graph, while weak learners review explicitly ([Skycak](https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/)) [vendor]. The pages read give no efficacy numbers. Budds' generated 6 to 15 objective map is a coarser, unvalidated hypothesis and should be revised as evidence arrives (inference).

## 3. Learner modelling and memory scheduling

**Knowledge tracing.** Logistic regression leads on moderate datasets, DKT on large ones, and BKT lags ([Gervet 2020](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/451)) [moderate]. [DKT's](https://arxiv.org/abs/1506.05908) lead disappears against extended BKT ([Khajah 2016](https://arxiv.org/abs/1604.02416)), and IRT variants matched or beat it ([Wilson 2016](https://arxiv.org/abs/1604.02336)) [moderate]. Elo is argued to be simple and robust ([Pelánek 2016](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf)) [moderate]. DAS3H adds forgetting to multi-skill models ([Choffin 2019](https://arxiv.org/abs/1905.06873)) [moderate].

**LLM tracing.** Jev with no target data reached mean AUC .706 on seven public datasets, above the best of 28 deep models trained on 8 learners (.689). Supervised models caught up between 64 and 128 learners, and deep KT stayed ahead on unseen items once all learners were logged ([Lee & Park 2026](https://arxiv.org/abs/2610.11135)) [weak/preprint]. New skills caused transient drops for meta-learned models ([MAML-KT 2026](https://arxiv.org/abs/2603.00137)) [weak/preprint]. These report prediction on existing question banks, not learning on generated topics. Practical choice (inference): a transparent per-objective estimate with LLM difficulty priors, updated only by unassisted attempts, with LLM judgments compared in shadow mode against delayed performance.

**FSRS versus SM-2.** On 9,999 Anki collections and 349,923,850 reviews, log loss is 0.3460 for FSRS-6 (21 parameters), 0.3401 for FSRS-7 (34) and 0.3620 for FSRS-7 with default parameters ([srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark)) [vendor: FSRS project]. SM-2 is absent from the README table. I computed 0.7220, and 0.5805 for trainable SM-2, as unweighted means of its [result file](https://github.com/open-spaced-repetition/srs-benchmark/blob/main/result/SM2.jsonl); the same method reproduced the README's 0.3620. Defaults suit sparse users. This is flashcard recall prediction, so use FSRS as a retention clock and check transfer separately (inference).

**Spacing and retrieval.** The best gap grows with retention interval, across 839 assessments ([Cepeda 2006](https://pubmed.ncbi.nlm.nih.gov/16719566/)) [strong]; in more than 1,350 people it falls from about 20 to 40% of a 1-week delay to 5 to 10% of a 1-year delay ([Cepeda 2008](https://pubmed.ncbi.nlm.nih.gov/19076480/)) [strong]. Testing beat restudy on delayed tests even though restudy raised confidence ([Roediger & Karpicke 2006](https://pubmed.ncbi.nlm.nih.gov/16507066/)) [strong]. Practice testing and distributed practice were rated high utility; rereading and highlighting do not consistently help ([Dunlosky 2013](https://pubmed.ncbi.nlm.nih.gov/26173288/)) [strong].

**How many retrievals.** With 533 students and more than 100,000 hand-scored recalls, the recommendation is **3 correct recalls, then 3 widely spaced relearning sessions** ([Rawson & Dunlosky 2011](https://pubmed.ncbi.nlm.nih.gov/21707204/)) [strong]. Relearning potency was d = 1.52 to 4.19 ([Rawson 2018](https://pubmed.ncbi.nlm.nih.gov/29431462/)) [moderate], and extra first-session criterion stops paying off once relearning occurs ([Vaughn 2016](https://pubmed.ncbi.nlm.nih.gov/27027887/)) [moderate]. Materials are mostly concepts and word pairs, so transfer needs its own evidence.

**Confidence and interleaving.** High-confidence errors are the most likely to be corrected after feedback ([Butterfield & Metcalfe 2001](https://pubmed.ncbi.nlm.nih.gov/11713883/)), less so in older adults ([Eich 2013](https://pubmed.ncbi.nlm.nih.gov/23241028/)) [moderate]. Interleaving averages g = 0.42 (math 0.34), is ambiguous for expository text, and favours blocking for words, g = -0.39 ([Brunmair & Richter 2019](https://doi.org/10.1037/bul0000209)) [strong].

## 4. AI tutoring trials and guardrails

| Study | Population | Result | Design | Tag |
| --- | --- | --- | --- | --- |
| [Bastani 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/) | Nearly 1,000 high schoolers, Turkey | Unassisted exam -17% base GPT; hint tutor -0.004 (SE 0.013) | Hints only; teacher-supplied solutions | [strong] |
| [Kestin 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/) | Harvard physics, N = 233 | 0.63 SD; 0.73 to 1.3 quantile | Solutions in prompt; software-enforced order | [moderate] |
| [De Simone 2025](https://ideas.repec.org/p/wbk/wbrwps/11125.html) | Nigerian secondary, six weeks | 0.31 SD; English 0.23 SD | Teacher-led Copilot | [weak/preprint] |
| [Tutor CoPilot](https://arxiv.org/abs/2410.03017) | 900 tutors, 1,800 students | +4 pp mastery; +9 pp lower-rated tutors | AI coaches humans | [weak/preprint] |
| [LearnLM x Eedi](https://arxiv.org/abs/2512.23633) | 165 UK students | Transfer +5.5 pp over human, CrI [-1.4, +12.4] | Tutor supervised every message | [vendor] |
| [Sierra Leone](https://storage.googleapis.com/deepmind-media/LearnLM/learnLM_sierraleone_may26.pdf) | 1,763 students, 48 classes | ITT +0.258 SD, p = 0.029 | Teacher-led; 2.1% direct solutions | [vendor] |
| [Tokyo](https://blog.google/products-and-platforms/products/education/guided-learning-uk-japan/) | More than 300 university students | +8.1 vs +5.3 pp, half a day | Blog only | [vendor] |
| [Study mode](https://openai.com/index/understanding-ai-and-learning-outcomes/) | More than 300 college students | Microeconomics about 15% higher; neuroscience indistinguishable | Analysis underway | [vendor] |
| [Khanmigo](https://edworkingpapers.com/sites/default/files/ai26-1551.pdf) | 18 Tennessee schools | 0.06 to 0.08 SD a year, like Khan without AI | Coach-only; used in 17% of mistake sessions | [weak/preprint] |
| [NUMI](https://edworkingpapers.com/sites/default/files/ai26-1552.pdf) | More than 6,000 students | About 3 pp on practiced delayed item, marginal | AI inside mastery flow | [weak/preprint] |
| [UMD](https://edworkingpapers.com/ai26-1598) | 2,379 undergraduates | Grades -0.27 to -0.37 SD | RAG; 73.8% of requests for information or solutions; about 15% of treated students used it; most instructors stayed in direct-instruction mode | [weak/preprint] |
| [Shen & Tamkin 2026](https://arxiv.org/abs/2601.20245) | 52 developers | Quiz d = 0.738 worse | Delegation harmed; engaged use did not | [vendor], [weak/preprint] |

**Meta-analyses need caution.** A 2026 synthesis reports g = 1.096, CI [0.087, 2.104], yet states both 7 and 1 randomized trials ([Liu 2026](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1848745/full)) [weak/preprint]. Weidlich et al. use [Deng 2025](https://doi.org/10.1016/j.compedu.2024.105224) to question treatments, controls and outcome validity ([critique](https://doi.org/10.31234/osf.io/t6uzy_v2)) [moderate]. Weight individual trials with unassisted outcomes above these.

**What separates results (inference across the table).**
1. *Unassisted measurement.* Bastani's practice scores rose 48% and 127% while exams did not.
2. *Withholding prevents harm, nothing more.* Bastani's hint tutor reached zero; Khanmigo's coach matched non-AI practice.
3. *Required engagement.* Optional help goes unused or becomes information retrieval.
4. *Verified solutions.* Bastani and Kestin both supplied them to limit hallucinations.
5. *Sequence in software.* Kestin found "a system prompt could not reliably provide enough structure" for multi-part problems.
6. *Human framing.* Nigeria, Sierra Leone, Eedi and CoPilot kept a person involved, so a solo adult product may not inherit those effects.
7. *Equity.* First-generation students lost more at UMD; stronger-baseline students gained more in Nigeria and Sierra Leone.

Bastani's hint-tutor students perceived significantly better performance with no exam gain.

**First-party modes.** [ChatGPT study mode](https://openai.com/index/chatgpt-study-mode/) is custom system instructions with Socratic prompts, level checks, memory, quizzes and a toggle; OpenAI admits "some inconsistent behavior." [Claude learning mode](https://www.anthropic.com/news/introducing-claude-for-education) guides reasoning with Socratic questions in Projects, and [Claude Code's Learning style](https://code.claude.com/docs/en/output-styles) has you write some code. [Gemini Guided Learning](https://blog.google/products-and-platforms/products/education/guided-learning/) uses probing questions and mixed media on LearnLM capabilities. [vendor] These are modes a learner can leave, so Budds' structural enforcement is worth keeping (inference).

## 5. Generative UI for learning

**Learn Your Way.** It re-levels and personalizes source-of-truth material, then derives quizzes, slides, audio and mind maps. With 60 students aged 15 to 18, it beat a PDF reader on immediate and retention tests (both p = 0.03; retention 78% vs 67%) ([blog](https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/), [paper](https://arxiv.org/abs/2509.13348)) [vendor], [weak/preprint]. The authors cannot say which component helped, and it included formative quizzes. This tests a bundle, not generated UI.

**Generative UI paper.** Gemini with tools, a detailed prompt and post-processors produced HTML preferred over markdown and "at least comparable" to expert pages in 44% of cases ([paper](https://generativeui.github.io/static/pdfs/paper.pdf)) [vendor], [weak/preprint]. The measure was preference, not learning. Generation can take over a minute, with occasional inaccuracies ([blog](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)). The paper does not mention sandboxing.

**Interactivity.** Simulations: g = 0.85 across 145 higher-education studies, with examples helping novices and reflection helping advanced learners ([Chernikova 2020](https://eric.ed.gov/?id=EJ1259299)) [strong; not limited to software]. PhET's circuit simulation beat real equipment ([Finkelstein 2005](https://eric.ed.gov/?id=EJ839536)) [moderate]. Multiple representations often fail unless design, function and task align ([Ainsworth 2006](https://doi.org/10.1016/j.learninstruc.2006.03.001)) [moderate]. Seductive details hinder learning ([Sundararajan & Adesope 2020](https://eric.ed.gov/?id=EJ1263249)) [strong]. A targeted 2026 search found no controlled study of learning from LLM-generated simulations.

| Pattern | Source | Budds fit |
| --- | --- | --- |
| Typed catalogue | [A2UI](https://github.com/google/A2UI): declarative JSON, client-owned components, no executable code; early public preview. [AI SDK](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces): tool results mapped to components | Default for everything graded |
| Exercise schema | [Perseus](https://github.com/Khan/perseus): renders and grades; [schema](https://github.com/Khan/perseus/blob/main/packages/perseus-core/src/data-schema.ts) pairs `content` with typed `widgets`; MIT | Model for assessment |
| Sandboxed HTML | [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), stable: mandatory iframe sandbox, proxy on a different origin, `connect-src 'none'` default | Simulations only |
| Hosted precedent | [Claude Code artifacts](https://code.claude.com/docs/en/artifacts): strict CSP, external images blocked. Claude.ai: sandboxed iframes per [staff quoted secondhand](https://simonwillison.net/2024/Aug/28/how-anthropic-built-artifacts/) | Confirms the pattern |

Rules (inference, except MDN): serve generated HTML from a separate registrable origin, with no cookies and a header CSP. Avoid `allow-scripts` with `allow-same-origin` on the same origin, because [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) notes the frame can remove its sandbox. Validate every `postMessage`. Never let the iframe write mastery; score typed inputs on the server. Treat KB and web text reaching the generator as a prompt-injection path. Remove any element that names no objective.

**Tiered provenance.** [NotebookLM's FAQ](https://support.google.com/notebooklm/answer/16269187?hl=en) says it won't respond if the answer isn't in the sources; web material arrives by [user import](https://support.google.com/gemininotebook/answer/16215270?hl=en&co=GENIE.Platform%3DDesktop) [vendor]. [Vertex check grounding](https://docs.cloud.google.com/generative-ai-app-builder/docs/reference/rest/v1alpha/projects.locations.groundingConfigs/check) scores claims with a default 0.6 citation threshold, and `groundingCheckRequired` marks claims needing no check, the nearest documented tier [vendor]. [Claude Citations](https://platform.claude.com/docs/en/build-with-claude/citations) guarantees valid pointers, which is not entailment [vendor]. Learn Your Way highlights personalized text, a precedent for labelling a generated layer ([paper](https://arxiv.org/abs/2509.13348)) [vendor]. Proposal (inference):

| Tier | Origin | Allowed use | Label |
| --- | --- | --- | --- |
| T0 | Accepted source, entailment checked | Claims, rubrics, answer keys | Citation |
| T1 | Fetched web, not accepted | Attributed teaching; promotable to T0 | "From the web" |
| T2 | Model knowledge | Analogies, examples, prerequisite bridges, prompts, simulations | "Not source-checked" |
| Blocked | Model knowledge | Answer keys, rubrics, high-stakes facts | Ask for a source |

A beginner with an empty KB can start without weakening what counts as verified. Measure T2 error rates directly, since Eedi's low rate (5 of 3,617 messages) came under human supervision.

## What this means for design

| Finding | Do | Don't |
| --- | --- | --- |
| Meshing fails | Evidence-based "how you're learning" profile | Style quiz or style routing |
| Support reverses with expertise | Conditional blocks; fade examples per objective | All 10 blocks for everyone |
| Starting points differ, rates don't | Calibrate, then vary opportunities | Treat 25 minutes as sufficient |
| KLI event types differ | Tag objectives as fluency, induction or sense-making | One pedagogy for all |
| Three-in-a-row alone didn't help | Pair gates with transfer and spacing | Treat in-session 80% as mastery |
| 3 + 3 successive relearning | Multiple spaced successes before "retained" | Stop at one 7-day check |
| FSRS beats SM-2, on flashcards | FSRS default clock plus transfer probes | SM-2, or early per-user fitting |
| Sparse data favours simple models | Per-objective estimate; LLM in shadow | DKT, or LLM-owned state changes |
| Perception misleads | Gate on unassisted delayed tasks | Satisfaction or confidence as progress |
| Withholding only avoids harm | Enforce attempts and sequence in code | Rely on a Socratic prompt |
| RAG tutor lowered grades | Keep chat subordinate to practice | Open chat as the core path |
| Interactivity needs alignment | Objective-tied widgets and sims | Visuals because they impress |
| Generated HTML is untrusted | Separate origin, strict CSP | App-origin rendering or state writes |
| Grounding and generality can coexist | T0 to T2 labels; source-bound keys | Silent blending, or blocking all scaffolding |

## Unverified / could not access

- **Tetzlaff 2025:** ScienceDirect blocked; numbers come from a secondary summary.
- **Rogowsky 2015:** abstract only; sample size not obtained.
- **Bloom 1984, Anania, Burke:** not read; claims rely on ERIC and von Hippel.
- **Kulik 1990 subgroups, Slavin 1987:** seen only via Nintil.
- **Sundararajan & Adesope effect size (g = -0.33), Lin 2024 grain-size subgroup (g = 0.89):** secondary only, excluded.
- **Mayer's multimedia principle effect size:** Springer blocked; no figure stated.
- **Corbett & Anderson 1995 (BKT), Deng 2025 pooled effect:** not retrieved.
- **Kirschner & van Merriënboer 2013, D'Angelo 2014, Wieman 2008, Ritter 2016:** not retrieved or not found.
- **JEDM threshold experiment:** abstract only; thresholds and sample unstated there.
- **De Simone 2025:** RePEc abstract only.
- **Google Tokyo trial:** blog only, no paper.
- **OpenAI posts:** live pages returned 403; read via Wayback. No full study is published.
- **Claude.ai Artifacts:** no official CSP documentation found; only the Claude Code page is first-party.
- **Khan Academy's 2026 auto-activation, J-PAL Canadian Khanmigo trial:** the first seen only as a citation and the second with no results found; both excluded.
- **Peer review:** no journal version confirmed for LearnLM x Eedi, Tutor CoPilot, Learn Your Way, Generative UI, Lee & Park or the 2026 working papers.
- **Math Academy efficacy:** none in the pages read; other first-party material may exist.
