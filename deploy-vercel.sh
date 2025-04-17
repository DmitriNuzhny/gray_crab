#!/bin/bash

# Deploy to Vercel script

echo "Preparing for Vercel deployment..."

# Make sure the latest changes are committed
git add .
git status

echo ""
echo "Please commit any pending changes before deploying."
echo "After committing, run:"
echo ""
echo "vercel"
echo ""
echo "And follow the prompts to deploy your application to Vercel."
echo ""
echo "Remember to set these environment variables in Vercel:"
echo "- SHOPIFY_STORE_ADMIN_API_URL"
echo "- SHOPIFY_STORE_ACCESS_TOKEN"
echo "- SHOPIFY_STORE_NAME"
echo "- SHOPIFY_STORE_WEBHOOK_SECRET (if used)"
echo ""
echo "For more details, refer to VERCEL_DEPLOYMENT.md" 