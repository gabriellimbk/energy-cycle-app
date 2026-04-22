import { GoogleGenAI, Type } from "@google/genai";
import { validateExtractedEquations } from "./chemistryValidation.js";

const ARROW_CONNECTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fromNode: { type: Type.STRING, description: "Exact text of the node where the arrow starts (the tail end, NOT the arrowhead end)." },
    toNode: { type: Type.STRING, description: "Exact text of the node where the arrow ends (the arrowhead/pointed end)." },
    label: { type: Type.STRING, description: "Visible arrow label such as ΔH, -3267, 6(-394), or blank if none is visible." },
    labelStatus: { type: Type.STRING, description: "One of: correct, incorrect, missing. Whether the arrow label matches the expected enthalpy value for this reaction step based on the provided reference data. Use 'missing' if no label is written. Use 'correct' if the numerical value (ignoring sign convention differences) matches. Use 'incorrect' if a label is written but the value is wrong." }
  },
  required: ["fromNode", "toNode", "label", "labelStatus"]
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER, description: "A score out of 10 for the student's work." },
    comments: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Specific feedback points based on the marking checklist. Do NOT include general comments about the energy cycle being well-drawn, complete, or clearly laid out — that is handled separately."
    },
    hessLawApplication: {
      type: Type.STRING,
      description: "Explanation of how successfully the Hess's Law mathematical calculation was applied."
    },
    energyCycleStatus: {
      type: Type.STRING,
      description: "One of: complete, incomplete. Complete means all required nodes and connecting arrows are present. Incomplete means the cycle is structurally missing essential elements."
    },
    hessLawStatus: {
      type: Type.STRING,
      description: "One of: correct, incorrect, missing. Based only on the written mathematical Hess's Law calculation, not on the cycle diagram."
    },
    deltaHCalculationStatus: {
      type: Type.STRING,
      description: "One of: correct, incorrect, missing. Based solely on whether a final numerical ΔH value is written anywhere and whether it matches the expected value. Do not consider cycle structure."
    },
    extractedEquations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Any explicit full reaction equations written in the student's diagram."
    },
    extractedNodeLabels: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Standalone Hess-cycle node labels or energy-level labels written in the student's diagram."
    },
    arrowConnections: {
      type: Type.ARRAY,
      items: ARROW_CONNECTION_SCHEMA,
      description: "Arrow connections in the Hess cycle, mapping visible start node, end node, and arrow label."
    },
    extractionNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Short notes describing unclear handwriting or uncertain tokens without correcting them."
    }
  },
  required: ["score", "comments", "hessLawApplication", "energyCycleStatus", "hessLawStatus", "deltaHCalculationStatus", "extractedEquations", "extractedNodeLabels", "arrowConnections", "extractionNotes"]
};

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  return new GoogleGenAI({ apiKey });
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function normalizeBinaryStatus(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "complete" || normalized === "incomplete") {
    return normalized;
  }

  return "";
}

function normalizeTernaryStatus(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "correct" || normalized === "incorrect" || normalized === "missing") {
    return normalized;
  }

  return "";
}

function normalizeArrowConnections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      fromNode: typeof entry.fromNode === "string" ? entry.fromNode.trim() : "",
      toNode: typeof entry.toNode === "string" ? entry.toNode.trim() : "",
      label: typeof entry.label === "string" ? entry.label.trim() : "",
      labelStatus: normalizeTernaryStatus(entry.labelStatus),
    }))
    .filter((entry) => entry.fromNode && entry.toNode);
}

function combineArrowLabels(labels) {
  const normalizedLabels = labels
    .map((label) => (typeof label === "string" ? label.trim() : ""))
    .filter(Boolean);

  if (normalizedLabels.length === 0) {
    return "";
  }

  return normalizedLabels.join(" + ");
}

function isMissingLabel(label) {
  if (typeof label !== "string") {
    return true;
  }

  const normalized = label.trim().toLowerCase();
  return !normalized || normalized === "blank" || normalized === "none" || normalized === "unlabelled" || normalized === "unlabeled";
}

function isFloatingNodeFragment(label, existingNodes) {
  if (typeof label !== "string") {
    return false;
  }

  const normalized = label.trim();
  if (!normalized) {
    return false;
  }

  if (existingNodes.some((node) => node.includes(normalized))) {
    return false;
  }

  if (normalized.includes("+") || normalized.includes("->") || normalized.includes("???")) {
    return false;
  }

  if (/[A-Z][a-z]?\d*\([^)]*\)/.test(normalized)) {
    return false;
  }

  return /^\([a-z]{1,3}\)$/i.test(normalized) || /^\d+(?:\/\d+)?$/.test(normalized);
}

function appendNodeFragment(node, fragment) {
  const trimmedNode = node.trim();
  const trimmedFragment = fragment.trim();

  if (!trimmedFragment || trimmedNode.includes(trimmedFragment)) {
    return trimmedNode;
  }

  return `${trimmedNode} ${trimmedFragment}`.replace(/\s+/g, " ").trim();
}

function stripInlineOxygenAnnotation(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s*\+\s*\d+(?:\/\d+)?\s*O(?:2|\u2082)\(g\)\s*$/gi, "")
    .replace(/^\s*\+\s*\d+(?:\/\d+)?\s*O(?:2|\u2082)\(g\)\s*/gi, "")
    .trim();
}

function sanitizeNodeLabel(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleanedLines = value
    .split(/\n+/)
    .map((line) => stripInlineOxygenAnnotation(line.trim()))
    .filter((line) => line && !line.startsWith("+"));

  return cleanedLines.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeComparableChemistryText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[â†’→]/g, "->")
    .replace(/[()]/g, (char) => char)
    .trim();
}

function splitReactionSides(reaction) {
  if (typeof reaction !== "string") {
    return null;
  }

  const sides = reaction.split(/\s*(?:->|\u2192|\u27F6|\u27F9|=>|=)\s*/);
  if (sides.length !== 2) {
    return null;
  }

  return {
    left: sides[0].trim(),
    right: sides[1].trim(),
  };
}

function getQuestionReferenceNodes(question) {
  const nodes = [];
  const seen = new Set();

  const pushNode = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const key = normalizeComparableChemistryText(trimmed);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    nodes.push(trimmed);
  };

  const targetReaction = splitReactionSides(question?.data?.reaction);
  if (targetReaction) {
    pushNode(targetReaction.left);
    pushNode(targetReaction.right);
  }

  for (const row of question?.data?.table || []) {
    const rowReaction = splitReactionSides(row?.equation);
    if (!rowReaction) {
      continue;
    }

    pushNode(rowReaction.left);
    pushNode(rowReaction.right);
  }

  return {
    nodes,
    targetReaction,
  };
}

function snapToReferenceNode(value, referenceNodes) {
  const sanitized = sanitizeNodeLabel(value);
  const comparable = normalizeComparableChemistryText(sanitized);
  if (!comparable) {
    return sanitized;
  }

  for (const candidate of referenceNodes) {
    const candidateComparable = normalizeComparableChemistryText(candidate);
    if (!candidateComparable) {
      continue;
    }

    if (
      comparable === candidateComparable ||
      comparable.includes(candidateComparable) ||
      candidateComparable.includes(comparable)
    ) {
      return candidate;
    }
  }

  return sanitized;
}

function isTrivialNodeLabel(value) {
  if (typeof value !== "string") {
    return true;
  }

  const normalized = value.trim();
  return !normalized || /^[\d\s()+\-/.]+$/.test(normalized);
}

function getCommonIntermediateNode(referenceNodes, extractedNodeLabels, arrowConnections) {
  const referenceKeys = new Set(referenceNodes.map((node) => normalizeComparableChemistryText(node)));
  const candidates = new Map();

  const noteCandidate = (value) => {
    const sanitized = sanitizeNodeLabel(value);
    const comparable = normalizeComparableChemistryText(sanitized);
    if (!sanitized || !comparable || referenceKeys.has(comparable) || isTrivialNodeLabel(sanitized)) {
      return;
    }

    const existing = candidates.get(sanitized) || { count: 0, length: sanitized.length };
    existing.count += 1;
    candidates.set(sanitized, existing);
  };

  for (const label of extractedNodeLabels || []) {
    noteCandidate(label);
  }

  for (const connection of arrowConnections || []) {
    noteCandidate(connection.fromNode);
    noteCandidate(connection.toNode);
  }

  const ranked = Array.from(candidates.entries()).sort((left, right) => {
    const leftScore = left[1].count * 100 + left[1].length;
    const rightScore = right[1].count * 100 + right[1].length;
    return rightScore - leftScore;
  });

  return ranked[0]?.[0] || "";
}

function formatOxygenCoefficient(oxygenAtoms) {
  const molecules = oxygenAtoms / 2;
  if (Number.isInteger(molecules)) {
    return String(molecules);
  }

  if (Number.isInteger(oxygenAtoms)) {
    return `${oxygenAtoms}/2`;
  }

  return molecules.toFixed(2).replace(/\.?0+$/, "");
}

function completeOxygenOnlyEquation(equation) {
  if (typeof equation !== "string" || !equation.trim()) {
    return equation;
  }

  const [check] = validateExtractedEquations([equation]);
  if (!check || check.status !== "unbalanced" || typeof check.issue !== "string") {
    return equation;
  }

  const match = check.issue.match(/^Not balanced\. O: (right|left) has ([\d.]+) more\.$/);
  if (!match) {
    return equation;
  }

  const oxygenAtoms = Number(match[2]);
  if (!Number.isFinite(oxygenAtoms) || oxygenAtoms <= 0) {
    return equation;
  }

  const oxygenTerm = `${formatOxygenCoefficient(oxygenAtoms)}O2(g)`;
  const sides = equation.split(/\s*(?:->|\u2192|\u27F6|\u27F9|=>|=)\s*/);
  if (sides.length !== 2) {
    return equation;
  }

  if (match[1] === "right") {
    return `${sides[0].trim()} + ${oxygenTerm} -> ${sides[1].trim()}`;
  }

  return `${sides[0].trim()} -> ${sides[1].trim()} + ${oxygenTerm}`;
}

function scoreEquationStatuses(checks) {
  return checks.reduce((score, check) => {
    if (check.status === "balanced") return score + 3;
    if (check.status === "ignored") return score + 1;
    if (check.status === "unverifiable") return score - 1;
    if (check.status === "unbalanced") return score - 4;
    return score;
  }, 0);
}

function optimizeNodeFragments(reconstructedFromArrows, extractedNodeLabels) {
  if (reconstructedFromArrows.length === 0) {
    return reconstructedFromArrows;
  }

  const uniqueNodes = Array.from(new Set(
    reconstructedFromArrows.flatMap((entry) => [entry.fromNode, entry.toNode]).filter(Boolean)
  ));
  const floatingFragments = extractedNodeLabels.filter((label) => isFloatingNodeFragment(label, uniqueNodes));

  if (floatingFragments.length === 0 || uniqueNodes.length === 0) {
    return reconstructedFromArrows;
  }

  let bestEntries = reconstructedFromArrows;
  let bestScore = scoreEquationStatuses(validateExtractedEquations(reconstructedFromArrows.map((entry) => entry.equation)));
  let bestAttachmentCount = 0;
  const totalBits = floatingFragments.length * uniqueNodes.length;
  const maxMasks = totalBits > 20 ? 1 << 20 : 1 << totalBits;

  for (let mask = 0; mask < maxMasks; mask += 1) {
    const augmentedNodes = new Map(uniqueNodes.map((node) => [node, node]));
    let attachmentCount = 0;

    for (let fragmentIndex = 0; fragmentIndex < floatingFragments.length; fragmentIndex += 1) {
      const fragment = floatingFragments[fragmentIndex];

      for (let nodeIndex = 0; nodeIndex < uniqueNodes.length; nodeIndex += 1) {
        const bitIndex = fragmentIndex * uniqueNodes.length + nodeIndex;
        if (bitIndex >= 31) {
          continue;
        }

        if ((mask & (1 << bitIndex)) !== 0) {
          const node = uniqueNodes[nodeIndex];
          augmentedNodes.set(node, appendNodeFragment(augmentedNodes.get(node) || node, fragment));
          attachmentCount += 1;
        }
      }
    }

    const candidateEntries = reconstructedFromArrows.map((entry) => {
      const nextFromNode = augmentedNodes.get(entry.fromNode) || entry.fromNode;
      const nextToNode = augmentedNodes.get(entry.toNode) || entry.toNode;

      return {
        ...entry,
        fromNode: nextFromNode,
        toNode: nextToNode,
        equation: `${nextFromNode} -> ${nextToNode}`,
      };
    });

    const candidateChecks = validateExtractedEquations(candidateEntries.map((entry) => entry.equation));
    const candidateScore = scoreEquationStatuses(candidateChecks);

    if (
      candidateScore > bestScore ||
      (candidateScore === bestScore && attachmentCount > 0 && attachmentCount < bestAttachmentCount)
    ) {
      bestEntries = candidateEntries;
      bestScore = candidateScore;
      bestAttachmentCount = attachmentCount;
    }
  }

  return bestEntries;
}

function reconstructArrowEquations(question, extractedEquations, extractedNodeLabels, arrowConnections) {
  const { nodes: referenceNodes, targetReaction } = getQuestionReferenceNodes(question);
  const commonIntermediateNode = getCommonIntermediateNode(referenceNodes, extractedNodeLabels, arrowConnections);
  const reconstructedFromArrows = arrowConnections.map((connection) => ({
    equation: `${connection.fromNode} -> ${connection.toNode}`,
    fromNode: connection.fromNode,
    toNode: connection.toNode,
    label: combineArrowLabels([connection.label]),
    source: "arrow",
    hasCompleteLabel: !isMissingLabel(connection.label),
    labelStatus: connection.labelStatus || "",
  }));

  if (reconstructedFromArrows.length > 0) {
    return reconstructedFromArrows.map((entry) => {
      const normalizedLabel = normalizeComparableChemistryText(entry.label);

      if (
        targetReaction &&
        (normalizedLabel.includes("δh") || normalizedLabel.includes("dh") || normalizedLabel.includes("h"))
      ) {
        return {
          ...entry,
          fromNode: targetReaction.left,
          toNode: targetReaction.right,
          equation: `${targetReaction.left} -> ${targetReaction.right}`,
        };
      }

      let fromNode = snapToReferenceNode(entry.fromNode, referenceNodes);
      let toNode = snapToReferenceNode(entry.toNode, referenceNodes);

      if (targetReaction && commonIntermediateNode) {
        const fromComparable = normalizeComparableChemistryText(fromNode);
        const toComparable = normalizeComparableChemistryText(toNode);
        const reactantComparable = normalizeComparableChemistryText(targetReaction.left);
        const productComparable = normalizeComparableChemistryText(targetReaction.right);

        if (fromComparable === reactantComparable || toComparable === reactantComparable) {
          fromNode = targetReaction.left;
          toNode = commonIntermediateNode;
        } else if (fromComparable === productComparable || toComparable === productComparable) {
          fromNode = targetReaction.right;
          toNode = commonIntermediateNode;
        }
      }

      const equation = completeOxygenOnlyEquation(`${fromNode} -> ${toNode}`);

      return {
        ...entry,
        fromNode,
        toNode,
        equation,
      };
    });
  }

  return extractedEquations.map((equation) => ({
    equation,
    fromNode: "",
    toNode: "",
    label: "",
    source: "explicit",
    hasCompleteLabel: null,
    labelStatus: "",
  }));
}

function isModelArrowLabelComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return (
    (normalized.includes("arrow") || normalized.includes("label")) &&
    !normalized.startsWith("balance check:") &&
    !normalized.startsWith("extraction check:")
  );
}

function isEnthalpyPraiseComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return normalized.includes("enthalpy") && (
    normalized.includes("correctly identified") ||
    normalized.includes("correct enthalpy") ||
    normalized.includes("right enthalpy") ||
    normalized.includes("identified the enthalpy")
  );
}

function isModelEnergyCycleStructureComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return (
    (normalized.includes("energy cycle") || normalized.includes("the cycle") || normalized.includes("the diagram")) &&
    !normalized.startsWith("balance check:") &&
    !normalized.startsWith("extraction check:")
  );
}

function isModelHessLawComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return normalized.includes("hess") || normalized.includes("final calculation");
}

function isModelDeltaHComment(comment) {
  if (typeof comment !== "string") {
    return false;
  }

  const normalized = comment.toLowerCase();
  return (
    normalized.includes("final answer") ||
    normalized.includes("calculated value") ||
    normalized.includes("value of") ||
    normalized.includes("value for") ||
    normalized.includes("no final calculation") ||
    normalized.includes("final calculation of")
  );
}

function isLowConfidenceExtraction(extractionNotes, uncertainExtractions) {
  return extractionNotes.length > 0 || uncertainExtractions.length > 0;
}

function getArrowLabelStatus(modelComments, arrowDerivedChecks) {
  if (arrowDerivedChecks.length === 0) {
    return null;
  }

  const hasMissingLabel = arrowDerivedChecks.some(
    (entry) => entry.labelStatus === "missing" || entry.hasCompleteLabel === false
  );
  if (hasMissingLabel) {
    return "incorrectly labelled arrows";
  }

  const hasIncorrectLabel = arrowDerivedChecks.some(
    (entry) => entry.labelStatus === "incorrect"
  );
  if (hasIncorrectLabel) {
    return "incorrectly labelled arrows";
  }

  const allHaveExplicitStatus = arrowDerivedChecks.every(
    (entry) => entry.labelStatus === "correct" || entry.labelStatus === "incorrect" || entry.labelStatus === "missing"
  );
  if (allHaveExplicitStatus) {
    return "correctly labelled arrows";
  }

  // Fallback: text-mine model comments only when AI did not return per-arrow labelStatus
  const hasNegativeArrowFeedback = modelComments.some((comment) => {
    if (typeof comment !== "string") {
      return false;
    }

    const normalized = comment.toLowerCase();
    return (
      normalized.includes("sign error") ||
      normalized.includes("double-check") ||
      normalized.includes("incorrect arrow") ||
      normalized.includes("incorrect label") ||
      normalized.includes("wrong label") ||
      normalized.includes("wrong sign") ||
      ((normalized.includes("arrow") || normalized.includes("label")) &&
        (normalized.includes("incorrect") || normalized.includes("missing") || normalized.includes("not ")))
    );
  });

  return hasNegativeArrowFeedback ? "incorrectly labelled arrows" : "correctly labelled arrows";
}

export async function analyzeStudentWork(question, imageBase64) {
  if (!question || !imageBase64) {
    throw new Error("Question and image are required.");
  }

  const prompt = `
    You are an expert Chemistry Teacher specializing in Thermodynamics and Hess's Law.
    You must separate what is visibly written from what you infer.

    A student has submitted a handwritten diagram (energy cycle or energy level diagram) in response to the following question:

    QUESTION:
    Subject: ${question.title}
    Instruction: ${question.instruction}
    Equation to Solve: ${question.data.reaction}
    Reference Data: ${JSON.stringify(question.data.table)}
    Expected Hess's Law Setup: ${question.answerHessLaw}
    Expected Final Value: ${question.expectedValue}

    MARKING CHECKLIST:
    1. Are all equations in the cycle balanced?
    2. Are there state symbols (s, l, g, aq) for ALL species?
    3. Are all arrows labelled with the specified ΔH or correct numerical value?
    4. Is Hess's Law applied correctly to reach the final answer?

    YOUR TASK:
    1. Extract any explicit full reaction equations the student has written.
    2. Extract the standalone node labels in the Hess cycle.
    3. Identify each arrow connection by start node, end node, and visible label.
    4. Classify whether the energy cycle diagram is structurally complete or incomplete.
    5. Classify the Hess's Law mathematical calculation as correct, incorrect, or missing.
    6. Classify the final ΔH numerical value as correct, incorrect, or missing.
    7. Mark the student's work based on the checklist.
    8. Provide constructive feedback (do NOT include general remarks about the cycle being well-drawn or clearly structured).

    ARROW DIRECTION RULES (critical — read carefully):
    - The arrowhead marks the DESTINATION (toNode). It appears as a pointed V-shape, >, or angular mark at one end of the drawn line.
    - For diagonal or slanted arrows: identify which physical end of the line has the pointed angular mark — that end is toNode, regardless of whether the arrow goes up, down, left, or right.
    - In a typical 3-box Hess cycle (two boxes on top-left and top-right, one box below): the two slanted side arrows almost always point DOWNWARD toward the lower common-level box. The upper-level boxes are fromNode for these side arrows.
    - In a 5-box cycle (two rows of two boxes, one bottom box): slanted arrows similarly point toward the common intermediate level.
    - Never assume direction from chemistry — rely only on the visible arrowhead position.
    - If you are genuinely unsure about the direction of a slanted arrow, note the uncertainty in extractionNotes.

    EXTRACTION RULES:
    - Transcribe text exactly as written. Do not silently correct chemistry, coefficients, species, or state symbols.
    - If a token is unclear, preserve the visible text as closely as possible and mention the uncertainty in extractionNotes.
    - Do not replace a handwritten coefficient with the chemically correct one just because it seems intended.
    - Put only complete reaction equations with an explicit reaction arrow into extractedEquations.
    - Put node text such as reactants, products, or common intermediates into extractedNodeLabels.
    - For arrowConnections, use the node text the arrow visually connects between. Do not invent nodes that are not present.
    - Keep each drawn arrow separate. Do not merge nearby arrows into one combined arrow connection.
    - If several arrows leave the same lower node toward different products, return separate arrowConnections for each visible arrow.
    - Do not infer arrow direction from chemistry; use only the visible arrowhead. If the arrowhead is unclear, keep the most literal reading and mention the uncertainty in extractionNotes.
    - Treat the long target reaction written across the top as a standalone equation unless it is clearly one of the drawn cycle arrows.
    - Treat floating combustion notes, added O2 terms, or small annotations written above or below a node as separate notes, not as part of that node.
    - Do not merge a nearby note into fromNode or toNode unless it is clearly written inline on the same baseline as the node text.
    - Treat floating combustion notes, added O2 terms, or small annotations written above or below a node as separate notes, not as part of that node.
    - Do not merge a nearby note into fromNode or toNode unless it is clearly written inline on the same baseline as the node text.
    - Do not treat arrow labels such as "-394", "4(-285.8)", or "ΔH" as equations.
    - Treat floating combustion notes, added O2 terms, or small annotations written above or below a node as separate notes, not as part of that node.
    - Do not merge a nearby note into fromNode or toNode unless it is clearly written inline on the same baseline as the node text.
    - In comments and hessLawApplication, base balance judgments on the implied equation for each arrow connection.
    - energyCycleStatus is about structure only: "complete" if all needed nodes and arrows are present and connected; "incomplete" if the cycle is missing nodes, arrows, or is disconnected.
    - hessLawStatus is about the WRITTEN MATHEMATICAL CALCULATION only, not the diagram structure. A correct cycle drawing without a written algebraic substitution is still "missing".
    - Use hessLawStatus = "missing" if the student has not written an explicit algebraic Hess's Law calculation (e.g. ΔH = value1 + value2 - value3).
    - Use hessLawStatus = "incorrect" if a written Hess's Law calculation is present but has wrong signs, wrong values, or incorrect arithmetic.
    - Use hessLawStatus = "correct" if the written Hess's Law calculation is present and yields the correct answer.
    - deltaHCalculationStatus is ONLY about the final numerical answer written by the student (e.g. "ΔH = -2719 kJ mol⁻¹" or just "-2719"). Ignore energy cycle structure completely.
    - Use deltaHCalculationStatus = "missing" if no final numerical ΔH value is written anywhere on the page.
    - Use deltaHCalculationStatus = "incorrect" if a final numerical ΔH value is written but does not match ${question.expectedValue}.
    - Use deltaHCalculationStatus = "correct" if the final numerical ΔH value written matches ${question.expectedValue} (allow minor rounding within ±1 unit).

    Remember: the goal is to reconstruct the equations represented by the Hess-cycle arrows.
  `;

  const cleanBase64 = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: "image/png",
            data: cleanBase64,
          },
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  if (!response.text) {
    throw new Error("AI failed to provide feedback.");
  }

  const parsedResponse = JSON.parse(response.text);
  const extractedEquations = normalizeStringArray(parsedResponse.extractedEquations);
  const extractedNodeLabels = normalizeStringArray(parsedResponse.extractedNodeLabels);
  const arrowConnections = normalizeArrowConnections(parsedResponse.arrowConnections);
  const extractionNotes = normalizeStringArray(parsedResponse.extractionNotes);
  const reconstructedEquations = reconstructArrowEquations(question, extractedEquations, extractedNodeLabels, arrowConnections);
  const reconstructedEquationChecks = validateExtractedEquations(reconstructedEquations.map((entry) => entry.equation))
    .map((check, index) => ({
      ...check,
      fromNode: reconstructedEquations[index]?.fromNode || "",
      toNode: reconstructedEquations[index]?.toNode || "",
      arrowLabel: reconstructedEquations[index]?.label || "",
      source: reconstructedEquations[index]?.source || "explicit",
      hasCompleteLabel: reconstructedEquations[index]?.hasCompleteLabel ?? null,
      labelStatus: reconstructedEquations[index]?.labelStatus || "",
    }));

  const unbalancedEquations = reconstructedEquationChecks.filter((entry) => entry.status === "unbalanced");
  const uncertainExtractions = reconstructedEquationChecks.filter((entry) => entry.status === "unverifiable");
  const lowConfidenceExtraction = isLowConfidenceExtraction(extractionNotes, uncertainExtractions);

  let score = typeof parsedResponse.score === "number" ? parsedResponse.score : 0;
  if (!lowConfidenceExtraction && unbalancedEquations.length > 0) {
    score = Math.max(0, Math.min(score, 6) - Math.max(0, unbalancedEquations.length - 1));
  }

  const modelComments = normalizeStringArray(parsedResponse.comments);
  const energyCycleStatus = normalizeBinaryStatus(parsedResponse.energyCycleStatus);
  const hessLawStatus = normalizeTernaryStatus(parsedResponse.hessLawStatus);
  const deltaHCalculationStatus = normalizeTernaryStatus(parsedResponse.deltaHCalculationStatus);
  const comments = modelComments
    .filter((comment) => !isModelArrowLabelComment(comment))
    .filter((comment) => !isEnthalpyPraiseComment(comment))
    .filter((comment) => !isModelHessLawComment(comment))
    .filter((comment) => !isModelDeltaHComment(comment))
    .filter((comment) => !isModelEnergyCycleStructureComment(comment));

  if (!lowConfidenceExtraction) {
    for (const failingEquation of unbalancedEquations) {
    comments.unshift(`Balance check: "${failingEquation.equation}" is unbalanced. ${failingEquation.issue}`);
    }
  }

  if (lowConfidenceExtraction) {
    comments.unshift("Extraction check: low-confidence handwriting extraction detected, so balance penalties were suppressed.");
  }

  if (energyCycleStatus === "complete") {
    comments.unshift("complete energy cycle");
  } else if (energyCycleStatus === "incomplete") {
    comments.unshift("incomplete energy cycle");
  }

  const arrowDerivedChecks = reconstructedEquationChecks.filter((entry) => entry.source !== "explicit");
  const arrowLabelStatus = getArrowLabelStatus(modelComments, arrowDerivedChecks);
  if (arrowLabelStatus) {
    comments.push(arrowLabelStatus);
  }

  if (hessLawStatus === "correct") {
    comments.push("correct application of Hess's Law");
  } else if (hessLawStatus === "incorrect") {
    comments.push("incorrect application of Hess's Law");
  } else if (hessLawStatus === "missing") {
    comments.push("missing application of Hess's Law");
  }

  if (deltaHCalculationStatus === "correct") {
    comments.push("correct calculated ΔH value");
  } else if (deltaHCalculationStatus === "incorrect") {
    comments.push("incorrect calculated ΔH value");
  } else if (deltaHCalculationStatus === "missing") {
    comments.push("missing calculated ΔH value");
  }

  let hessLawApplication = typeof parsedResponse.hessLawApplication === "string"
    ? parsedResponse.hessLawApplication
    : "";

  if (lowConfidenceExtraction) {
    hessLawApplication = `Low-confidence handwriting extraction was detected, so reconstructed equations were excluded from balance penalties. ${hessLawApplication}`.trim();
  } else if (unbalancedEquations.length > 0) {
    hessLawApplication = `Deterministic validation found ${unbalancedEquations.length} unbalanced reconstructed equation${unbalancedEquations.length === 1 ? "" : "s"}. ${hessLawApplication}`.trim();
  }

  return {
    score,
    comments,
    hessLawApplication,
    extractedEquations,
    extractedNodeLabels,
    arrowConnections,
    extractionNotes,
    reconstructedEquationChecks,
  };
}
