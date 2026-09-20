import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const facts = [
  ['Name the inputs plants use for photosynthesis.', 'carbon dioxide and water', 'carbon dioxide', 'oxygen and glucose', 'Plants use carbon dioxide and water to make glucose during photosynthesis.'],
  ['Name the main products of photosynthesis.', 'glucose and oxygen', 'oxygen', 'carbon dioxide and water', 'Photosynthesis produces glucose and releases oxygen.'],
  ['Name two functions of plant roots.', 'anchoring the plant and absorbing water', 'absorbing water', 'making flowers and dispersing seeds', 'Roots anchor a plant and absorb water and minerals from soil.'],
  ['Name the two products of mitosis.', 'two genetically identical daughter cells', 'two daughter cells', 'four genetically different cells', 'Mitosis produces two genetically identical daughter cells.'],
  ['Name the substances red blood cells transport.', 'oxygen and some carbon dioxide', 'oxygen', 'digestive enzymes and bile', 'Red blood cells deliver oxygen and carry some carbon dioxide away.'],
  ['Name the two chambers that pump blood out of the heart.', 'the left and right ventricles', 'the left ventricle', 'the left and right atria', 'The left and right ventricles pump blood out of the heart.'],
  ['Name two components found in DNA nucleotides.', 'a sugar and a phosphate group', 'a sugar', 'a protein and a lipid', 'Each DNA nucleotide includes a deoxyribose sugar and a phosphate group.'],
  ['Name two conditions enzymes need to work effectively.', 'a suitable temperature and pH', 'a suitable temperature', 'bright light and high salinity', 'Enzyme activity depends on suitable temperature and pH ranges.'],
  ['Name the two principal gases in Earth’s atmosphere.', 'nitrogen and oxygen', 'nitrogen', 'carbon dioxide and hydrogen', 'Earth’s atmosphere is composed mainly of nitrogen and oxygen.'],
  ['Name two processes in the water cycle.', 'precipitation and collection', 'precipitation', 'combustion and erosion', 'Water falls as precipitation and collects in bodies of water during the water cycle.'],
  ['Name the two factors that create seasons.', 'Earth’s axial tilt and its orbit around the Sun', 'Earth’s axial tilt', 'daily rotation and distance from the Moon', 'Seasons result from Earth’s axial tilt as Earth orbits the Sun.'],
  ['Name two forces acting on a falling object.', 'gravity and air resistance', 'gravity', 'magnetism and buoyancy', 'A falling object is pulled by gravity and opposed by air resistance.'],
  ['Name the two quantities in the formula for momentum.', 'mass and velocity', 'mass', 'temperature and volume', 'Momentum is calculated by multiplying mass by velocity.'],
  ['Name two forms of energy stored in a stretched bow.', 'elastic potential and chemical energy in the archer', 'elastic potential energy', 'nuclear and geothermal energy', 'A stretched bow stores elastic potential energy while the archer supplies chemical energy.'],
  ['Name the two poles of a magnet.', 'north and south', 'north', 'east and west', 'Every magnet has a north pole and a south pole.'],
  ['Name the two particles in an atomic nucleus.', 'protons and neutrons', 'protons', 'electrons and photons', 'An atomic nucleus contains protons and neutrons.'],
  ['Name two properties that distinguish acids from bases.', 'acids have low pH and donate hydrogen ions', 'acids have low pH', 'acids have high pH and release hydroxide ions', 'Acids generally have low pH and can donate hydrogen ions.'],
  ['Name the two elements in water.', 'hydrogen and oxygen', 'hydrogen', 'helium and nitrogen', 'A water molecule contains hydrogen and oxygen.'],
  ['Name the two changes of state between liquid and gas.', 'evaporation and condensation', 'evaporation', 'melting and freezing', 'Evaporation changes liquid to gas; condensation changes gas to liquid.'],
  ['Name two signs of a chemical reaction.', 'gas formation and a temperature change', 'gas formation', 'a change of container and stirring', 'Gas formation and an unexpected temperature change can indicate a chemical reaction.'],
  ['Name the capital and official language of France.', 'Paris and French', 'Paris', 'Lyon and Spanish', 'Paris is the capital of France, whose official language is French.'],
  ['Name the capital and continent of Kenya.', 'Nairobi and Africa', 'Nairobi', 'Mombasa and Asia', 'Nairobi is Kenya’s capital, and Kenya is in Africa.'],
  ['Name the river and sea central to ancient Egyptian trade.', 'the Nile and the Mediterranean Sea', 'the Nile', 'the Amazon and the Baltic Sea', 'Ancient Egyptian trade used the Nile and reached the Mediterranean Sea.'],
  ['Name the two countries sharing the Iberian Peninsula.', 'Spain and Portugal', 'Spain', 'Italy and Greece', 'Spain and Portugal occupy most of the Iberian Peninsula.'],
  ['Name the largest ocean and largest continent.', 'the Pacific Ocean and Asia', 'the Pacific Ocean', 'the Atlantic Ocean and Europe', 'The Pacific is the largest ocean, and Asia is the largest continent.'],
  ['Name the two branches of the United States Congress.', 'the Senate and the House of Representatives', 'the Senate', 'the Cabinet and the Supreme Court', 'Congress consists of the Senate and the House of Representatives.'],
  ['Name two responsibilities commonly assigned to municipal government.', 'local roads and waste collection', 'local roads', 'national defence and foreign treaties', 'Municipal governments commonly manage local roads and waste collection.'],
  ['Name two principles of procedural fairness.', 'notice and an opportunity to be heard', 'notice', 'secrecy and automatic punishment', 'Procedural fairness includes notice and a meaningful opportunity to be heard.'],
  ['Name the two sides in a typical civil lawsuit.', 'the plaintiff and the defendant', 'the plaintiff', 'the prosecutor and the jury', 'A civil lawsuit is brought by a plaintiff against a defendant.'],
  ['Name two checks on executive power in a constitutional system.', 'legislative oversight and judicial review', 'judicial review', 'hereditary succession and censorship', 'Legislative oversight and judicial review can constrain executive power.'],
  ['Name the two operations used to solve x + 7 = 12.', 'subtract seven and simplify', 'subtract seven', 'multiply by seven and round', 'Subtracting seven from both sides and simplifying isolates x.'],
  ['Name the numerator and denominator of one half.', 'one and two', 'one', 'two and one', 'In the fraction one half, one is the numerator and two is the denominator.'],
  ['Name the two dimensions multiplied to find rectangle area.', 'length and width', 'length', 'radius and circumference', 'The area of a rectangle equals its length multiplied by its width.'],
  ['Name two equivalent forms of fifty percent.', 'one half and 0.5', 'one half', 'one quarter and 0.25', 'Fifty percent is equivalent to one half and the decimal 0.5.'],
  ['Name the two coordinates in an ordered pair.', 'x and y', 'x', 'radius and angle only', 'A two-dimensional ordered pair gives an x-coordinate and a y-coordinate.'],
  ['Name the two truth values in Boolean logic.', 'true and false', 'true', 'positive and negative', 'Boolean logic uses the truth values true and false.'],
  ['Name two core jobs of an operating system.', 'managing hardware and running applications', 'managing hardware', 'designing websites and writing reports', 'An operating system manages hardware resources and runs applications.'],
  ['Name the two parts of an HTTP response that describe outcome and content.', 'the status code and body', 'the status code', 'the keyboard and monitor', 'An HTTP response includes a status code and a response body.'],
  ['Name two properties provided by cryptographic hashing.', 'deterministic output and tamper detection', 'tamper detection', 'reversible encryption and anonymity', 'A cryptographic hash is deterministic and helps reveal content tampering.'],
  ['Name the two basic actions in version control collaboration.', 'committing changes and merging branches', 'committing changes', 'printing files and deleting history', 'Teams commonly commit changes and merge branches in version control.'],
  ['Name the author and protagonist of Frankenstein.', 'Mary Shelley and Victor Frankenstein', 'Mary Shelley', 'Jane Austen and Sherlock Holmes', 'Mary Shelley wrote Frankenstein, whose central scientist is Victor Frankenstein.'],
  ['Name the playwright and tragic hero of Hamlet.', 'William Shakespeare and Prince Hamlet', 'William Shakespeare', 'Charles Dickens and Macbeth', 'William Shakespeare wrote Hamlet, centred on Prince Hamlet.'],
  ['Name two literary devices that make a direct comparison and an implied comparison.', 'simile and metaphor', 'simile', 'alliteration and punctuation', 'A simile makes an explicit comparison; a metaphor makes an implied comparison.'],
  ['Name the two main parts of a complete English sentence.', 'a subject and a predicate', 'a subject', 'a title and a footnote', 'A complete sentence conventionally contains a subject and a predicate.'],
  ['Name two purposes of citing a source.', 'crediting the author and enabling verification', 'crediting the author', 'hiding evidence and preventing review', 'Citations credit original authors and allow readers to verify claims.'],
  ['Name the two primary colours mixed to make green in subtractive colour.', 'blue and yellow', 'blue', 'red and orange', 'In traditional subtractive colour mixing, blue and yellow make green.'],
  ['Name the composer and musical period of The Four Seasons.', 'Antonio Vivaldi and the Baroque period', 'Antonio Vivaldi', 'Ludwig van Beethoven and the Romantic period', 'Antonio Vivaldi composed The Four Seasons during the Baroque period.'],
  ['Name two visual elements artists use to suggest depth.', 'overlap and linear perspective', 'overlap', 'spelling and rhyme', 'Artists can suggest depth through overlap and linear perspective.'],
  ['Name the artist and city associated with Guernica.', 'Pablo Picasso and Guernica', 'Pablo Picasso', 'Claude Monet and Paris', 'Pablo Picasso named Guernica after the Spanish town bombed during the civil war.'],
  ['Name two practices that improve source evaluation.', 'checking authorship and corroborating claims', 'checking authorship', 'counting images and trusting headlines', 'Strong source evaluation checks authorship and corroborates claims with independent evidence.'],
]

const variants = [
  question => question,
  question => `Using the supplied excerpt, ${question[0].toLowerCase()}${question.slice(1)}`,
  question => `Answer both requested parts: ${question}`,
  question => `Based only on the evidence, ${question[0].toLowerCase()}${question.slice(1)}`,
]
const labels = ['fully_correct', 'partially_correct', 'incorrect', 'uncertain']

const fitAdditionalFacts = [
  ['Name two core parts of a CPU.', 'the control unit and arithmetic logic unit', 'the control unit', 'the monitor and printer', 'A CPU includes a control unit and an arithmetic logic unit.'],
  ['Name two reliability functions provided by TCP.', 'packet sequencing and retransmission', 'packet sequencing', 'screen rendering and file compression', 'TCP provides ordered sequencing and retransmits missing data.'],
  ['Name the two values connected by DNS resolution.', 'domain names and IP addresses', 'domain names', 'passwords and credit cards', 'DNS resolution connects human-readable domain names with IP addresses.'],
  ['Name two ACID properties of database transactions.', 'atomicity and durability', 'atomicity', 'animation and duplication', 'ACID transactions include atomicity and durability guarantees.'],
  ['Name the two keys in public-key cryptography.', 'a public key and a private key', 'a public key', 'a colour key and a keyboard key', 'Public-key cryptography uses a related public key and private key.'],
  ['Name two principal structures of a neuron.', 'dendrites and an axon', 'dendrites', 'alveoli and tendons', 'A neuron receives signals through dendrites and sends them along an axon.'],
  ['Name two functions performed by the kidneys.', 'filtering blood and removing waste', 'filtering blood', 'pumping air and digesting protein', 'The kidneys filter blood and remove metabolic waste in urine.'],
  ['Name the cell and molecule central to antibody responses.', 'B cells and antibodies', 'B cells', 'red blood cells and insulin', 'B cells can differentiate into cells that produce antibodies.'],
  ['Name two major components of cell membranes.', 'phospholipids and proteins', 'phospholipids', 'cellulose and bone', 'Cell membranes are built mainly from phospholipids with embedded proteins.'],
  ['Name two ecological roles in nutrient cycling.', 'producers and decomposers', 'producers', 'planets and satellites', 'Producers capture energy while decomposers return nutrients to ecosystems.'],
  ['Name two features of a divergent plate boundary.', 'separating plates and new crust', 'separating plates', 'colliding plates and disappearing oceans', 'At divergent boundaries plates separate and new crust forms.'],
  ['Name the location and measure commonly reported for an earthquake.', 'the epicentre and magnitude', 'the magnitude', 'the orbit and brightness', 'Earthquake reports commonly identify the epicentre and magnitude.'],
  ['Name two quantities measured at a weather station.', 'temperature and humidity', 'temperature', 'sentence length and melody', 'Weather stations measure quantities including temperature and humidity.'],
  ['Name two processes that break down and move rock.', 'weathering and erosion', 'weathering', 'photosynthesis and mitosis', 'Weathering breaks rock down, and erosion transports the material.'],
  ['Name the two sides whose interaction helps set a market price.', 'supply and demand', 'supply', 'latitude and longitude', 'Market prices are influenced by the interaction of supply and demand.'],
  ['Name two main categories on a balance sheet.', 'assets and liabilities', 'assets', 'rhythm and harmony', 'A balance sheet reports assets and liabilities, along with equity.'],
  ['Name two elements needed to form a basic agreement.', 'offer and acceptance', 'offer', 'weather and geography', 'A basic agreement is formed through an offer and acceptance.'],
  ['Name two safeguards of constitutional democracy.', 'free elections and the rule of law', 'free elections', 'secret decrees and inherited office', 'Constitutional democracy relies on free elections and the rule of law.'],
  ['Name the two variable roles in a controlled experiment.', 'independent and dependent variables', 'the independent variable', 'uppercase and lowercase letters', 'An experiment changes an independent variable and measures a dependent variable.'],
  ['Name two measures of central tendency.', 'mean and median', 'mean', 'slope and acceleration', 'Mean and median are both measures of central tendency.'],
  ['Name two foundational elements of music.', 'melody and rhythm', 'melody', 'altitude and rainfall', 'Music commonly organizes melody and rhythm.'],
  ['Name two crafts that shape a film scene.', 'cinematography and editing', 'cinematography', 'tax accounting and soil testing', 'Cinematography captures the images, while editing shapes their sequence.'],
  ['Name two qualities improved during writing revision.', 'clarity and coherence', 'clarity', 'humidity and voltage', 'Revision can improve a text’s clarity and coherence.'],
  ['Name two tools that help interpret a map.', 'the scale and legend', 'the scale', 'a chorus and a microscope', 'A map scale shows distance and its legend explains symbols.'],
  ['Name two nutrients that support energy and tissue repair.', 'carbohydrates and protein', 'carbohydrates', 'sand and carbon monoxide', 'Carbohydrates supply energy, while dietary protein supports tissue repair.'],
]

const fitFacts = [
  ...facts.filter((_, index) => index % 2 === 0),
  ...fitAdditionalFacts,
]
const heldoutFacts = [
  ...facts.filter((_, index) => index % 2 === 1),
  ['Name two factors used to rank preferred employers.', 'company culture and job opportunities', 'company culture', 'office size and logo colour', 'Employer rankings can consider company culture and job opportunities.'],
  ['Name two parts of a balanced job offer.', 'fair compensation and growth opportunities', 'fair compensation', 'free snacks and a short company name', 'A balanced offer combines fair compensation with opportunities for growth.'],
  ['Name two habits that support sleep health.', 'a consistent schedule and reduced evening screen use', 'a consistent schedule', 'late caffeine and irregular bedtimes', 'Sleep health improves with a consistent schedule and less evening screen use.'],
  ['Name two measures commonly used for heart health.', 'blood pressure and resting heart rate', 'blood pressure', 'shoe size and hair colour', 'Blood pressure and resting heart rate are common cardiovascular measures.'],
  ['Name two parts of informed medical consent.', 'clear information and voluntary agreement', 'clear information', 'hidden risks and automatic enrollment', 'Informed consent requires clear information and voluntary agreement.'],
  ['Name two causes of inflation discussed in economics.', 'demand growth and supply constraints', 'demand growth', 'longer words and colder colours', 'Inflation can reflect strong demand and constrained supply.'],
  ['Name two functions of money.', 'a medium of exchange and a store of value', 'a medium of exchange', 'a weather forecast and a voting method', 'Money serves as a medium of exchange and a store of value.'],
  ['Name two signals of a recession.', 'falling output and rising unemployment', 'falling output', 'rising output and falling unemployment', 'Recessions commonly involve declining output and increasing unemployment.'],
  ['Name two benefits of wetland restoration.', 'flood control and wildlife habitat', 'flood control', 'more pavement and less biodiversity', 'Restored wetlands reduce floods and provide wildlife habitat.'],
  ['Name two sources of renewable electricity.', 'solar and wind power', 'solar power', 'coal and diesel', 'Solar and wind are renewable sources of electricity.'],
  ['Name two effects of urban tree cover.', 'cooler streets and improved air quality', 'cooler streets', 'hotter streets and more exhaust', 'Urban trees can cool streets and improve air quality.'],
  ['Name two protections provided by multifactor authentication.', 'a second verification factor and reduced password-only risk', 'a second verification factor', 'public passwords and disabled alerts', 'Multifactor authentication adds another verification factor and reduces password-only risk.'],
  ['Name two properties of a database index.', 'faster lookups and additional storage cost', 'faster lookups', 'slower queries and no storage use', 'Indexes speed many lookups while consuming additional storage.'],
  ['Name two responsibilities of a web browser.', 'rendering pages and enforcing origin security', 'rendering pages', 'manufacturing routers and issuing passports', 'Browsers render web content and enforce origin-based security rules.'],
  ['Name the event and year associated with the fall of the Berlin Wall.', 'the opening of the wall and 1989', '1989', 'the moon landing and 1969', 'The Berlin Wall opened in 1989 amid political change in East Germany.'],
  ['Name the movement and leader associated with India’s Salt March.', 'Indian independence and Mahatma Gandhi', 'Mahatma Gandhi', 'Italian unification and Garibaldi', 'Mahatma Gandhi led the Salt March as part of India’s independence movement.'],
  ['Name the civilization and writing system associated with cuneiform.', 'Sumer and wedge-shaped script', 'Sumer', 'Maya and alphabetic Morse code', 'Sumerian scribes used the wedge-shaped writing known as cuneiform.'],
  ['Name two techniques used in documentary photography.', 'careful framing and truthful context', 'careful framing', 'invented captions and hidden staging', 'Documentary photography relies on considered framing and truthful context.'],
  ['Name the artist and medium associated with The Thinker.', 'Auguste Rodin and bronze sculpture', 'Auguste Rodin', 'Georgia O’Keeffe and watercolor', 'Auguste Rodin created The Thinker as a bronze sculpture.'],
  ['Name two elements of theatrical staging.', 'lighting and blocking', 'lighting', 'database indexes and chemical bonds', 'Theatrical staging uses lighting and performer blocking.'],
  ['Name two ways a journalist corroborates a claim.', 'independent sources and documentary evidence', 'independent sources', 'anonymous repetition and guesswork', 'Journalists corroborate claims with independent sources and documentary evidence.'],
  ['Name two characteristics of a strong password manager.', 'encrypted storage and unique password generation', 'encrypted storage', 'shared plaintext files and repeated passwords', 'A strong password manager encrypts stored secrets and generates unique passwords.'],
  ['Name two features of accessible digital text.', 'sufficient contrast and meaningful headings', 'sufficient contrast', 'tiny low-contrast type and missing structure', 'Accessible text uses sufficient contrast and meaningful heading structure.'],
  ['Name two steps in evaluating an investment risk.', 'estimating possible loss and checking time horizon', 'estimating possible loss', 'ignoring volatility and borrowing blindly', 'Risk evaluation considers possible loss and the investor’s time horizon.'],
  ['Name two practices that reduce food waste.', 'meal planning and proper storage', 'meal planning', 'oversized purchases and poor refrigeration', 'Planning meals and storing food properly can reduce waste.'],
]

const fitRows = buildRows('fit', fitFacts)
const heldoutRows = buildRows('heldout', heldoutFacts)

const fitAnswers = new Set(fitRows.map(row => normalize(row.expectedAnswer)))
const heldoutAnswers = new Set(heldoutRows.map(row => normalize(row.expectedAnswer)))
if ([...fitAnswers].some(answer => heldoutAnswers.has(answer))) {
  throw new Error('Fit and held-out expected answers must be normalized-disjoint.')
}

const artifacts = [
  ['fit.v1.jsonl', fitRows],
  ['heldout.v1.jsonl', heldoutRows],
]
for (const [filename, rows] of artifacts) {
  if (rows.length !== 800 || labels.some(label => rows.filter(row => row.expectedLabel === label).length !== 200)) {
    throw new Error(`${filename} invariant failed: expected 800 rows and 200 rows per label.`)
  }
  const output = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
  const outputPath = path.join(process.cwd(), 'workers/laya-evaluator/calibration', filename)
  if (process.argv.includes('--write')) await fs.writeFile(outputPath, output)
  else if (await fs.readFile(outputPath, 'utf8') !== output) throw new Error(`${filename} differs from deterministic generator output. Run with --write and review the diff.`)
}

process.stdout.write(`${JSON.stringify({ fitRows: fitRows.length, heldoutRows: heldoutRows.length, perLabel: 200, groupedDisjoint: true })}\n`)

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function buildRows(prefix, scenarios) {
  const rows = []
  for (const label of labels) {
    for (const [scenarioIndex, fact] of scenarios.entries()) {
      const [question, answer, partial, wrong, evidence] = fact
      const parts = answer.split(/\s+and\s+/i)
      const learnerVariants = {
        fully_correct: [answer, parts.length === 2 ? `${parts[1]} and ${parts[0]}` : `Both ${answer}`, parts.length === 2 ? answer.replace(/\s+and\s+/i, ' & ') : `Equivalent wording: ${answer}`, `${answer}!`],
        partially_correct: [partial, parts[1] || partial, `${partial}, but not the other requested part`, `Only ${partial}`],
        incorrect: [wrong, `not ${answer}`, `${wrong}; definitely not ${answer}`, 'Neither requested detail is supported.'],
        uncertain: [answer, partial, wrong, 'The excerpt does not say.'],
      }
      if (answer === 'company culture and job opportunities') {
        learnerVariants.fully_correct = ['culture and opportunities', 'opportunities & cultures', 'opportunities, culture', 'cultures & opportunity']
        learnerVariants.partially_correct = ['culture', 'opportunities', 'company culture only', 'job opportunities only']
        learnerVariants.incorrect = ['culture and salary', 'no cultures and no opportunities', 'cultured and opportunities', 'culture and opportunitieses']
      }
      for (const [variantIndex, renderQuestion] of variants.entries()) {
        rows.push({
          id: `${prefix}-${String(rows.length + 1).padStart(3, '0')}`,
          expectedLabel: label,
          scenarioId: `${prefix}-scenario-${String(scenarioIndex + 1).padStart(3, '0')}`,
          question: renderQuestion(question),
          questionType: (scenarioIndex + variantIndex) % 5 === 0 ? 'fill_in_the_blank' : 'free-response',
          expectedAnswer: answer,
          learnerAnswer: learnerVariants[label][variantIndex],
          evidenceExcerpt: label === 'uncertain' ? ambiguousEvidence(question, scenarioIndex, variantIndex) : evidence,
          language: 'en',
        })
      }
    }
  }
  return rows
}

function ambiguousEvidence(question, scenarioIndex, variantIndex) {
  const topic = question.replace(/[?.]$/, '').toLowerCase()
  const templates = [
    `Field notes introduce the topic “${topic}” and then compare two accounts whose recorded details conflict.`,
    `A damaged reference card is headed “${topic}”; its surviving lines describe the surrounding context and two competing interpretations.`,
    `The classroom transcript discusses “${topic}” through examples, while different speakers use incompatible details.`,
    `A museum label about “${topic}” gives background and dates, but the relevant names appear differently in two editions.`,
    `The lab notebook section titled “${topic}” records the procedure and observations before the final identification was entered.`,
    `A map annotation concerning “${topic}” preserves two alternative labels from different survey years.`,
    `The policy summary addresses “${topic}” and quotes two drafts that assign the details differently.`,
    `An archived study guide covers “${topic}” but juxtaposes two unresolved candidate descriptions.`,
  ]
  return templates[(scenarioIndex * 4 + variantIndex) % templates.length]
}
