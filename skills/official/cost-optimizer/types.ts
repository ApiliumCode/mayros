export interface Optimization {
  rule: string;
  description: string;
  estimatedSavings: string;
  applicable: boolean;
}

export interface CostAnalysis {
  model: string;
  optimizations: Optimization[];
}
