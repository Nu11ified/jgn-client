import type { MetadataRoute } from 'next';

// TODO: Replace 'https://yourdomain.com' with your actual production domain
const BASE_URL = 'https://panel.justicerp.com';

// Placeholder function for fetching dynamic form IDs
// You'll need to implement this based on your data source (e.g., tRPC query)
async function getAllFormIds(): Promise<{ id: string | number }[]> {
  // Example:
  // const forms = await api.form.getAllPublicForms.query(); // Adjust based on your API
  // return forms.map(form => ({ id: form.id }));
  console.warn("Sitemap: getAllFormIds is using placeholder data. Implement actual data fetching.");
  return [{ id: 'example-form-1' }, { id: 'example-form-2' }]; // Placeholder
}

// Placeholder function for fetching dynamic response IDs (adjust as needed for different contexts)
// You might need separate functions or more complex logic if response IDs vary significantly per section
async function getAllResponseIds(context?: string): Promise<{ id: string | number }[]> {
  // Example:
  // const responses = await api.responses.getAllPublicResponses.query({ type: context });
  console.warn(`Sitemap: getAllResponseIds (context: ${context}) is using placeholder data. Implement actual data fetching.`);
  return [{ id: 'example-response-1' }, { id: 'example-response-2' }]; // Placeholder
}


export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  // Static Pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/admin`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/admin/form`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/auth/login`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/auth/logout`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/dashboard`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/dashboard/form`, lastModified, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/dashboard/form/finalapprover`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/dashboard/form/finalapprover/history`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/dashboard/form/reviewer`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
    // Routes that appear dynamic but might be single pages from your log (adjust if they have params)
    { url: `${BASE_URL}/admin/ban-history`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE_URL}/admin/role-mappings`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/admin/roles`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/admin/servers`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/admin/teamspeak-groups`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/admin/users`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE_URL}/dashboard/profile`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
  ];

  // Dynamic Form Pages: /dashboard/form/[formId]
  const formIds = await getAllFormIds();
  const dynamicFormPages: MetadataRoute.Sitemap = formIds.map(form => ({
    url: `${BASE_URL}/dashboard/form/${form.id}`,
    lastModified, // Ideally, fetch lastModified for each specific form
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  // Dynamic Final Approver Pages: /dashboard/form/finalapprover/[responseId]
  const finalApproverResponseIds = await getAllResponseIds('finalApprover');
  const dynamicFinalApproverPages: MetadataRoute.Sitemap = finalApproverResponseIds.map(response => ({
    url: `${BASE_URL}/dashboard/form/finalapprover/${response.id}`,
    lastModified,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  // Dynamic Final Approver History Pages: /dashboard/form/finalapprover/history/[responseId]
  const finalApproverHistoryResponseIds = await getAllResponseIds('finalApproverHistory');
  const dynamicFinalApproverHistoryPages: MetadataRoute.Sitemap = finalApproverHistoryResponseIds.map(response => ({
    url: `${BASE_URL}/dashboard/form/finalapprover/history/${response.id}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));
  
  // Dynamic Reviewer Pages: /dashboard/form/reviewer/[responseId]
  const reviewerResponseIds = await getAllResponseIds('reviewer');
  const dynamicReviewerPages: MetadataRoute.Sitemap = reviewerResponseIds.map(response => ({
    url: `${BASE_URL}/dashboard/form/reviewer/${response.id}`,
    lastModified,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  // Dynamic Reviewer Form Pages: /dashboard/form/reviewer/form/[responseId]
  // Note: This path structure `reviewer/form/[responseId]` was from the build log. Confirm if it's correct.
  const reviewerFormResponseIds = await getAllResponseIds('reviewerForm');
  const dynamicReviewerFormPages: MetadataRoute.Sitemap = reviewerFormResponseIds.map(response => ({
    url: `${BASE_URL}/dashboard/form/reviewer/form/${response.id}`,
    lastModified,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  // Dynamic Submission Pages: /dashboard/form/submission/[responseId]
  const submissionResponseIds = await getAllResponseIds('submission');
  const dynamicSubmissionPages: MetadataRoute.Sitemap = submissionResponseIds.map(response => ({
    url: `${BASE_URL}/dashboard/form/submission/${response.id}`,
    lastModified,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  return [
    ...staticPages,
    ...dynamicFormPages,
    ...dynamicFinalApproverPages,
    ...dynamicFinalApproverHistoryPages,
    ...dynamicReviewerPages,
    ...dynamicReviewerFormPages,
    ...dynamicSubmissionPages,
  ];
} 