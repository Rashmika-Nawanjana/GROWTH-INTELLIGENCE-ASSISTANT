import type { AgentOutput, CampaignVariant } from '../types';

function buildFallbackGroundingSignals(researchOutputs: AgentOutput[]): string[] {
  return researchOutputs
    .flatMap(output => output.facts.slice(0, 2).map(fact => `[${output.domain}] ${fact}`))
    .filter(Boolean)
    .slice(0, 3);
}

function buildSafeFallbackVariant(product: string, fallbackSignals: string[]): CampaignVariant {
  return {
    id: 'V1-SIGNAL-LED',
    angle: 'Signal-led baseline',
    hypothesis: `Grounding outreach in live market signals will increase reply quality for ${product}.`,
    successMetric: 'reply rate > 3% within 7 days',
    variable: 'opening hook angle',
    channels: {
      email: {
        subject: `${product}: one signal worth testing this week`,
        body: `We identified a live market signal relevant to your team and translated it into a practical campaign angle. If useful, we can share the short breakdown and test plan.`,
        followUps: ['Happy to send the signal snapshot and variant test matrix.'],
      },
      linkedin: {
        hook: 'One live signal changed our outreach priority this week.',
        post: `We used fresh competitor and audience data to frame a tighter message for ${product}. If you want, I can share the exact angle and why it should outperform generic outreach.`,
      },
    },
    groundedSignals: fallbackSignals.length > 0 ? fallbackSignals : ['No external signals available; fallback variant generated from prior context only.'],
  };
}

export function enforceExecutionGrounding(
  variants: CampaignVariant[],
  researchOutputs: AgentOutput[],
  product: string,
): CampaignVariant[] {
  const fallbackSignals = buildFallbackGroundingSignals(researchOutputs);
  const safeVariants = variants.map((variant, index) => {
    const groundedSignals = (variant.groundedSignals ?? []).filter(Boolean);
    const safeSignals = groundedSignals.length > 0 ? groundedSignals : fallbackSignals;
    const fallbackHypothesisSignal = safeSignals[0] ?? `recent signals for ${product}`;

    return {
      ...variant,
      id: variant.id?.trim() || `V${index + 1}-SIGNAL`,
      angle: variant.angle?.trim() || `Signal-led angle ${index + 1}`,
      hypothesis: variant.hypothesis?.trim() || `This angle should outperform generic outreach because of ${fallbackHypothesisSignal}.`,
      successMetric: variant.successMetric?.trim() || 'reply rate > 3% within 7 days',
      variable: variant.variable?.trim() || 'opening hook angle',
      groundedSignals: safeSignals.length > 0
        ? safeSignals.slice(0, 4)
        : ['No external signals available; fallback variant generated from prior context only.'],
    };
  });

  if (safeVariants.length > 0) {
    return safeVariants;
  }
  return [buildSafeFallbackVariant(product, fallbackSignals)];
}
