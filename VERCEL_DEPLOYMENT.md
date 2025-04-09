# Deploying to Vercel

This guide provides step-by-step instructions for deploying this Express.js app to Vercel.

## Prerequisites

1. A Vercel account. You can sign up at [vercel.com](https://vercel.com).
2. The Vercel CLI installed (optional but recommended for testing). Install with:
   ```
   npm install -g vercel
   ```
3. A GitHub account to host your repository.

## Deployment Steps

### 1. Push your code to GitHub

Make sure your codebase (including the newly added files) is committed to GitHub:

```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push
```

### 2. Deploy via Vercel Dashboard

1. Go to the [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New..." and select "Project"
3. Import your GitHub repository
4. Configure project settings:
   - Build Command: `npm run build` (this should be pre-filled)
   - Output Directory: `dist` (this should be auto-detected)
   - Install Command: `yarn install` (since your project uses Yarn)
   - Root Directory: `.` (default)
5. Environment Variables: Add all your environment variables from `.env` file
   - Click "Environment Variables" and add each variable from your `.env` file
   - At minimum, add:
     - `STORE_API_URL`
     - `STORE_API_KEY`
     - `SHOPIFY_STORE`
     - `SHOPIFY_WEBHOOK_SECRET` (if used)
6. Click "Deploy"

### 3. Alternative: Deploy via Vercel CLI

If you prefer using the command line:

```bash
# Login to Vercel
vercel login

# Deploy (run in project root)
vercel

# Follow the prompts to configure your deployment
```

### 4. Important Notes

1. **Cron/Scheduler Service**: Vercel serverless functions have limitations with long-running processes. We've added a conditional check to prevent the scheduler from running in the serverless environment. For proper scheduled tasks, consider using:
   - Vercel Cron Jobs (in the Vercel dashboard)
   - A separate service for handling scheduled tasks (e.g., a dedicated server or AWS Lambda)

2. **Environment Variables**: Make sure all required environment variables are set in the Vercel dashboard.

3. **Project Structure**: The deployment is configured to use `dist/vercel.js` as the entry point, which is built from `src/vercel.ts`.

### 5. Verifying Deployment

After deployment:

1. Vercel will provide a URL for your deployed application (e.g., `https://your-app.vercel.app`)
2. Test the API endpoints:
   - `https://your-app.vercel.app/api/products`
   - `https://your-app.vercel.app/api/sync`
   - `https://your-app.vercel.app/api/webhooks`

### 6. Troubleshooting

If you encounter issues:

1. Check Vercel logs in the dashboard under "Deployments" > [your deployment] > "Functions"
2. Verify all environment variables are correctly set
3. Ensure your code works locally before deployment

For further assistance, refer to the [Vercel documentation](https://vercel.com/docs). 