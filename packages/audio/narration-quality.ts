export const narrationQualityBounds=Object.freeze({minLufs:-24,maxLufs:-16,maxTruePeakDbtp:-1,maxLeadMs:500,maxTailMs:1200});
export interface NarrationQuality {integratedLufs:number;truePeakDbtp:number;leadingSilenceMs:number;trailingSilenceMs:number}
