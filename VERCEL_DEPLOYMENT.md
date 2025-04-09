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
4. The configuration is now defined in the `vercel.json` file, so the build settings in the UI will be ignored
5. Environment Variables: Add all your environment variables from `.env` file
   - Click "Environment Variables" and add each variable from your `.env` file
   - At minimum, add:
     - `STORE_API_URL`
     - `STORE_API_KEY`
     - `SHOPIFY_STORE`
     - `SHOPIFY_WEBHOOK_SECRET` (if used)
   - Ensure `VERCEL=true` is set (added automatically by Vercel)
6. Click "Deploy"

### 3. Alternative: Deploy via Vercel CLI

If you prefer using the command line:

```bash
# Install Vercel CLI if you haven't already
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (run in project root)
vercel

# Follow the prompts to configure your deployment
```

During the CLI setup, most settings will be taken from your `vercel.json` file, but make sure to configure your environment variables when prompted.

### 4. About Build Settings Warning

You might see a warning like:

```
WARN! Due to `buildCommand` existing in your configuration file, the Build and Development Settings defined in your Project Settings will not apply. Learn More: https://vercel.link/unused-build-settings
```

This is completely normal and not an error. It simply means that Vercel is using the settings from your `vercel.json` file instead of any settings configured in the Vercel dashboard UI.

### 5. Important Notes

1. **Cron/Scheduler Service**: Vercel serverless functions have limitations with long-running processes. We've added a conditional check to prevent the scheduler from running in the serverless environment. For proper scheduled tasks, consider using:
   - Vercel Cron Jobs (in the Vercel dashboard)
   - A separate service for handling scheduled tasks (e.g., a dedicated server or AWS Lambda)

2. **Environment Variables**: Make sure all required environment variables are set in the Vercel dashboard.

3. **Project Structure**: The deployment is now configured to use the `api/index.js` file as the entry point, which imports your compiled Express app.

### 6. Verifying Deployment

After deployment:

1. Vercel will provide a URL for your deployed application (e.g., `https://your-app.vercel.app`)
2. Test the API endpoints:
   - `https://your-app.vercel.app/api/products`
   - `https://your-app.vercel.app/api/sync`
   - `https://your-app.vercel.app/api/webhooks`

### 7. Troubleshooting

If you encounter schema validation errors in `vercel.json`:
1. Make sure all properties in the file are valid according to Vercel's configuration schema
2. Express.js is not a recognized framework in Vercel, so avoid using the `framework` property

If you encounter "DEPLOYMENT_NOT_FOUND" or similar errors:

1. **Check Vercel logs**: In the Vercel dashboard, go to your project, then Deployments > [your deployment] > Functions to view detailed logs.

2. **Verify the build process**: Run `yarn build` locally and check if the expected files are generated in the `dist` directory.

3. **Check environment variables**: Ensure all required environment variables are set correctly.

4. **Try with the Vercel CLI**: Sometimes the CLI provides more detailed error messages.
   ```bash
   vercel --debug
   ```

5. **API folder structure**: Make sure your `api/index.js` file is correctly exporting your Express app.

For further assistance, refer to the [Vercel documentation](https://vercel.com/docs) or contact Vercel support. 