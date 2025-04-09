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
echo "- STORE_API_URL"
echo "- STORE_API_KEY"
echo "- SHOPIFY_STORE"
echo "- SHOPIFY_WEBHOOK_SECRET (if used)"
echo ""
echo "For more details, refer to VERCEL_DEPLOYMENT.md" 