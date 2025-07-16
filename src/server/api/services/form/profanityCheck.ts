import { TRPCError } from "@trpc/server";

// Common slurs and derogatory terms
const SLURS_AND_DEROGATORY_TERMS = [
  // Racial slurs
  "n*gger", "n*gga", "ch*nk", "sp*c", "w*tback", "k*ke", "g*ok", "r*ghead",
  // Homophobic slurs  
  "f*ggot", "f*g", "d*ke", "tr*nny",
  // General offensive terms
  "ret*rd", "ret*rded", "sp*stic", "cr*pple",
  // Add more as needed - use asterisks to avoid false positives
].map(term => term.replace(/\*/g, '[a-z*@#$%^&!0-9]*'));

// Spam patterns
const SPAM_PATTERNS = [
  /(.)\1{20,}/, // Repeated characters (20+ times)
  /^(.{1,10})\1{20,}$/, // Repeated short phrases (5+ times)
  /[A-Z]{20,}/, // Excessive caps (20+ consecutive)
  /[!@#$%^&*()]{10,}/, // Excessive special characters
  /\b(buy|sell|cheap|free|click|visit|www\.|http|\.com|\.net|\.org)\b.*\b(now|today|here|link)\b/i, // Common spam phrases
];

// Excessive profanity patterns
const PROFANITY_WORDS = [
  "fuck", "shit", "damn", "hell", "ass", "bitch", "bastard", "crap", "piss"
];

export interface ContentAnalysis {
  isClean: boolean;
  issues: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  blockedReasons: string[];
}

export interface FormContentCheck {
  answers: Array<{ questionId: string; value: string | string[] | boolean }>;
  userId: string;
  formId: number;
}

/**
 * Analyzes text content for various issues including slurs, spam, and excessive profanity
 */
export function analyzeTextContent(text: string): ContentAnalysis {
  const issues: string[] = [];
  const blockedReasons: string[] = [];
  let severity: ContentAnalysis['severity'] = 'low';

  if (!text || typeof text !== 'string') {
    return { isClean: true, issues: [], severity: 'low', blockedReasons: [] };
  }

  const normalizedText = text.toLowerCase().trim();
  
  // Check for slurs and derogatory terms
  const slurMatches = SLURS_AND_DEROGATORY_TERMS.filter(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(normalizedText);
  });

  if (slurMatches.length > 0) {
    issues.push(`Contains ${slurMatches.length} potential slur(s) or derogatory term(s)`);
    blockedReasons.push('Contains offensive slurs or derogatory language');
    severity = 'critical';
  }

  // Check for spam patterns
  const spamMatches = SPAM_PATTERNS.filter(pattern => pattern.test(text));
  if (spamMatches.length > 0) {
    issues.push('Contains spam-like patterns');
    blockedReasons.push('Content appears to be spam');
    if (severity !== 'critical') severity = 'high';
  }

  // Check for excessive profanity
  const profanityCount = PROFANITY_WORDS.reduce((count, word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = text.match(regex);
    return count + (matches ? matches.length : 0);
  }, 0);

  if (profanityCount > 5) {
    issues.push(`Excessive profanity detected (${profanityCount} instances)`);
    blockedReasons.push('Excessive use of profanity');
    if (severity === 'low') severity = 'medium';
  } else if (profanityCount > 10) {
    blockedReasons.push('Extreme excessive use of profanity');
    if (severity !== 'critical') severity = 'high';
  }

  // Check text length for potential abuse
  if (text.length > 10000) {
    issues.push('Extremely long text content');
    if (severity === 'low') severity = 'medium';
  }

  // Check for potential trolling patterns
  const trollPatterns = [
    /lorem ipsum/i,
    /test{3,}/i,
    /a{20,}/i,
    /1{20,}/i,
    /copy.*paste/i,
    /placeholder/i
  ];

  const trollMatches = trollPatterns.filter(pattern => pattern.test(text));
  if (trollMatches.length > 0) {
    issues.push('Contains potential troll/test content');
    if (severity === 'low') severity = 'medium';
  }

  const isClean = blockedReasons.length === 0;

  return {
    isClean,
    issues,
    severity,
    blockedReasons
  };
}

/**
 * Rate limiting check - simple in-memory store (in production, use Redis or database)
 */
const submissionTracker = new Map<string, { count: number; lastSubmission: Date; windowStart: Date }>();

export function checkRateLimit(userId: string, formId: number): { allowed: boolean; reason?: string } {
  const key = `${userId}-${formId}`;
  const now = new Date();
  const windowMs = 60 * 60 * 1000; // 1 hour window
  const maxSubmissions = 5; // Max 5 submissions per hour per form

  const existing = submissionTracker.get(key);
  
  if (!existing) {
    submissionTracker.set(key, { count: 1, lastSubmission: now, windowStart: now });
    return { allowed: true };
  }

  // Reset window if it's been more than an hour
  if (now.getTime() - existing.windowStart.getTime() > windowMs) {
    submissionTracker.set(key, { count: 1, lastSubmission: now, windowStart: now });
    return { allowed: true };
  }

  // Check if user is submitting too frequently (less than 30 seconds apart)
  if (now.getTime() - existing.lastSubmission.getTime() < 30000) {
    return { allowed: false, reason: 'Submissions too frequent. Please wait at least 30 seconds between submissions.' };
  }

  // Check if user has exceeded max submissions in window
  if (existing.count >= maxSubmissions) {
    return { allowed: false, reason: `Too many submissions. Maximum ${maxSubmissions} submissions per hour allowed.` };
  }

  // Update tracker
  submissionTracker.set(key, { 
    count: existing.count + 1, 
    lastSubmission: now, 
    windowStart: existing.windowStart 
  });

  return { allowed: true };
}

/**
 * Comprehensive form content validation
 */
export function validateFormContent({ answers, userId, formId }: FormContentCheck): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Rate limiting check
  const rateLimitResult = checkRateLimit(userId, formId);
  if (!rateLimitResult.allowed) {
    errors.push(rateLimitResult.reason || 'Rate limit exceeded');
  }

  // Analyze each text answer
  let totalIssues = 0;
  let criticalIssues = 0;

  for (const answer of answers) {
    let textToAnalyze = '';
    
    if (typeof answer.value === 'string') {
      textToAnalyze = answer.value;
    } else if (Array.isArray(answer.value)) {
      textToAnalyze = answer.value.join(' ');
    } else {
      continue; // Skip boolean values
    }

    const analysis = analyzeTextContent(textToAnalyze);
    
    if (!analysis.isClean) {
      totalIssues++;
      
      if (analysis.severity === 'critical') {
        criticalIssues++;
        errors.push(`Question ${answer.questionId}: ${analysis.blockedReasons.join(', ')}`);
      } else if (analysis.severity === 'high') {
        errors.push(`Question ${answer.questionId}: ${analysis.issues.join(', ')}`);
      } else {
        warnings.push(`Question ${answer.questionId}: ${analysis.issues.join(', ')}`);
      }
    }
  }

  // Block submission if there are critical issues
  const isValid = criticalIssues === 0 && errors.length === 0;

  return {
    isValid,
    errors,
    warnings
  };
}

/**
 * Clean up old rate limit entries (call this periodically)
 */
export function cleanupRateLimitTracker(): void {
  const now = new Date();
  const windowMs = 60 * 60 * 1000; // 1 hour

  for (const [key, data] of submissionTracker.entries()) {
    if (now.getTime() - data.windowStart.getTime() > windowMs * 2) {
      submissionTracker.delete(key);
    }
  }
}

// Clean up every 30 minutes
setInterval(cleanupRateLimitTracker, 30 * 60 * 1000);