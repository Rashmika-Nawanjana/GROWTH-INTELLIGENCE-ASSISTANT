1:
Installing Playwright
Get started by installing Playwright using one of the following methods.

Using npm, yarn or pnpm
The command below either initializes a new project or adds Playwright to an existing one.

npm
yarn
pnpm
npm init playwright@latest

When prompted, choose / confirm:

TypeScript or JavaScript (default: TypeScript)
Tests folder name (default: tests, or e2e if tests already exists)
Add a GitHub Actions workflow (recommended for CI)
Install Playwright browsers (default: yes)
You can re-run the command later; it does not overwrite existing tests.

Using the VS Code Extension
You can also create and run tests with the VS Code Extension.

What's Installed
Playwright downloads required browser binaries and creates the scaffold below.

playwright.config.ts         # Test configuration
package.json
package-lock.json            # Or yarn.lock / pnpm-lock.yaml
tests/
  example.spec.ts            # Minimal example test

The playwright.config centralizes configuration: target browsers, timeouts, retries, projects, reporters and more. In existing projects dependencies are added to your current package.json.

tests/ contains a minimal starter test.

Running the Example Test
By default tests run headless in parallel across Chromium, Firefox and WebKit (configurable in playwright.config). Output and aggregated results display in the terminal.

npm
yarn
pnpm
npx playwright test

tests running in command line

Tips:

See the browser window: add --headed.
Run a single project/browser: --project=chromium.
Run one file: npx playwright test tests/example.spec.ts.
Open testing UI: --ui.
See Running Tests for details on filtering, headed mode, sharding and retries.

HTML Test Reports
After a test run, the HTML Reporter provides a dashboard filterable by the browser, passed, failed, skipped, flaky and more. Click a test to inspect errors, attachments and steps. It auto-opens only when failures occur; open manually with the command below.

npm
yarn
pnpm
npx playwright show-report

HTML Report

Running the Example Test in UI Mode
Run tests with UI Mode for watch mode, live step view, time travel debugging and more.

npm
yarn
pnpm
npx playwright test --ui

UI Mode

See the detailed guide on UI Mode for watch filters, step details and trace integration.

Updating Playwright
Update Playwright and download new browser binaries and their dependencies:

npm
yarn
pnpm
npm install -D @playwright/test@latest
npx playwright install --with-deps

Check your installed version:

npm
yarn
pnpm
npx playwright --version

System requirements
Node.js: latest 20.x, 22.x or 24.x.
Windows 11+, Windows Server 2019+ or Windows Subsystem for Linux (WSL).
macOS 14 (Ventura) or later.
Debian 12 / 13, Ubuntu 22.04 / 24.04 (x86-64 or arm64).
What's next
Write tests using web-first assertions, fixtures and locators
Run single or multiple tests; headed mode
Generate tests with Codegen
View a trace of your tests


2:
Puppeteer
build npm puppeteer package


Puppeteer is a JavaScript library which provides a high-level API to control Chrome or Firefox over the DevTools Protocol or WebDriver BiDi. Puppeteer runs in the headless (no visible UI) by default

Get started | API | FAQ | Contributing | Troubleshooting
Installation
npm
Yarn
pnpm
Bun
npm i puppeteer # Downloads compatible Chrome during installation.
npm i puppeteer-core # Alternatively, install as a library, without downloading Chrome.

MCP
Install chrome-devtools-mcp, a Puppeteer-based MCP server for browser automation and debugging.

Puppeteer also supports the experimental WebMCP API.

Example
import puppeteer from 'puppeteer';
// Or import puppeteer from 'puppeteer-core';

// Launch the browser and open a new blank page.
const browser = await puppeteer.launch();
const page = await browser.newPage();

// Navigate the page to a URL.
await page.goto('https://developer.chrome.com/');

// Set screen size.
await page.setViewport({width: 1080, height: 1024});

// Open the search menu using the keyboard.
await page.keyboard.press('/');

// Type into search box using accessible input name.
await page.locator('::-p-aria(Search)').fill('automate beyond recorder');

// Wait and click on first result.
await page.locator('.devsite-result-item-link').click();

// Locate the full title with a unique string.
const textSelector = await page
  .locator('::-p-text(Customize and automate)')
  .waitHandle();
const fullTitle = await textSelector?.evaluate(el => el.textContent);

// Print the full title.
console.log('The title of this blog post is "%s".', fullTitle);

await browser.close();

3:
token = 76bc085eb1e14b77835a1880d2f02490e0083ed2f14
Scrape.do provides unblocked access to public web data at scale by:

Avoiding all anti-bot, WAF, and CAPTCHA through custom bypass solutions.
Rotating 110M+ datacenter, residential, and mobile proxies in 150 countries.
Seamlessly rendering and interacting web pages with its managed headless browser.
After signing up for Scrape.do and generating your API key, test your setup with a basic request:


Proxy Mode
curl
python
node
go
ruby
java
csharp
php

curl --location --request GET 'https://api.scrape.do/?token=YOUR_TOKEN&url=https://httpbin.co/anything'
Generate API Token
All your requests are authorized with your account token, which is automatically generated when you first sign up.

Your token is located in your dashboard here:

Token Location
If you haven't signed up yet, create a free-forever account here.

API Playground
The API Playground is your interactive testing environment where you can experiment with Scrape.do parameters without writing code. Use it to:

Test different parameter combinations in real-time
Generate code snippets in multiple programming languages (Python, Node.js, PHP, cURL, etc.)
Preview API responses before implementing in your application
Learn how parameters affect request behavior
API Playground Dashboard

Access the playground from your dashboard to build and refine your scraping requests with instant feedback.

Encode Your Target URL
Pass the target website URL you want to scrape using the url parameter.

When using API mode, you must URL-encode the parameter to prevent it from being misinterpreted as multiple query parameters (supported protocols: HTTP and HTTPS).

curl
python
node
go
ruby
java
csharp
php

sudo apt-get install gridsite-clients
urlencode "YOUR_URL"
No need to encode the URL if you use Proxy Mode.

API Parameters Overview
You can view all the parameters of Scrape.do from the table below and have an overview of all of them quickly.

Parameter	Type	Default	Description	Details
token*	string		The token to use for authentication.	more
url*	string		Target web page URL.	more
super	bool	false	Use Residential & Mobile Proxy Networks	more
geoCode	string		Choose the right country for your target web page	more
regionalGeoCode	string		Choose continent for your target web page	more
sessionId	int		Use the same IP address continuously with a session	more
customHeaders	bool	false	Handle all request headers for the target web page	more
extraHeaders	bool	false	Use it to change header values or add new headers over the ones we have added	more
forwardHeaders	bool	false	Forward your own headers to the target website	more
setCookies	string		Set cookies for the target web page	more
disableRedirection	bool	false	Disable request redirection for your use-case	more
callback	string		Deprecated. Use Async API webhooks instead	more
timeout	int	60000	Set maximum timeout for your requests	more
retryTimeout	int	15000	Set maximum timeout for retry mechanism	more
disableRetry	bool	false	Disable retry mechanism for your use-case	more
device	string	desktop	Specify the device type (desktop, mobile, tablet)	more
render	bool	false	Use a headless browser to render JavaScript and wait for content to load	more
waitUntil	string	domcontentloaded	Control when the browser considers the page loaded	more
customWait	int	0	Set the browser wait time on the target web page after content loaded	more
waitSelector	string		CSS selector to wait for in the target web page	more
width	int	1920	Browser viewport width in pixels	more
height	int	1080	Browser viewport height in pixels	more
blockResources	bool	true	Block CSS, images, and fonts on your target web page	more
screenShot	bool	false	Return a screenshot from your target web page	more
fullScreenShot	bool	false	Return a full page screenshot from your target web page	more
particularScreenShot	string		Return a screenshot of a particular area from your target web page	more
playWithBrowser	string		Simulate browser actions like click, scroll, execute js, etc.	more
output	string	raw	Get the output in raw or markdown format	more
transparentResponse	bool	false	Return pure response from target web page without Scrape.do processing	more
returnJSON	bool	false	Returns network requests with content as a property string	more
showFrames	bool	false	Returns all iframe content from the target webpage (requires render=true and returnJSON=true)	more
showWebsocketRequests	bool	false	Display websocket requests (requires render=true and returnJSON=true)	more
pureCookies	bool	false	Returns the original Set-Cookie headers from the target website	more
How Does Scrape.do Work?
Modern websites use sophisticated anti-bot systems (Cloudflare, PerimeterX, DataDome, Akamai) that fingerprint TLS handshakes, validate HTTP headers, and blacklist datacenter IPs to block automated traffic.

Scrape.do solves this by handling all anti-bot evasion on your behalf.

Technically, we act as an intelligent proxy layer between your application and target websites. Every request is intercepted, upgraded to mimic legitimate browser behavior at multiple layers (TLS, HTTP, JavaScript), routed through our residential/mobile proxy network, and delivered as if from a real user. Your request goes through our infrastructure which:

Routes through rotating proxies — Your request is forwarded through our pool of 110M+ datacenter, residential, and mobile IPs across 150 countries, automatically rotating to avoid rate limits and IP bans.

Mimics real browser behavior — We manipulate TLS fingerprints and HTTP headers to match legitimate browser traffic, making your requests indistinguishable from organic users to bypass WAFs and anti-bot systems.

Renders JavaScript if needed — Setting render=true spins up a headless browser (Chromium) to execute JavaScript and load dynamic content, essential for modern SPAs built with React, Vue, or Angular.

Handles CAPTCHAs automatically — When target sites present CAPTCHA challenges (reCAPTCHA, hCaptcha, etc.), our system detects and solves them transparently without your intervention.

Retries intelligently — If a request fails due to temporary issues (502/503, timeouts, rate limits), we automatically retry with a different IP until success or timeout.

Returns clean data — You receive the raw HTML, JSON, or any content type the target website returns. API credits are only consumed on successful requests (2xx status codes).

For asynchronous processing of long-running jobs, use the Async API to submit jobs and receive results via webhook instead of keeping connections open.

Credits
Credits are the unit of billing in Scrape.do. You are only charged for successful requests (status codes 2xx, 400, 404, 410). Failed requests are free.

Not all requests cost the same. Some websites require advanced bypass methods (residential proxies, headless browser rendering, or custom anti-detection solutions), which consume more credits per request. For example, a basic datacenter request costs 1 credit, while a residential proxy request with JS rendering costs 25.

See the full Request Costs table for credit pricing by request type and domain-specific pricing.

Concurrency
Concurrency is the number of requests your account can process simultaneously. Each plan has a concurrency limit that determines how many requests can be in-flight at the same time.

If you hit your concurrency limit, additional requests will be queued or rejected until a slot opens up. The Async API has a separate concurrency pool (30% of your plan limit) that runs independently from your main API concurrency, so you can use both without interference.

4:
Use BeautifulSoup with HTTPX
Copy for LLM

In this guide, you'll learn how to use the BeautifulSoup library with the HTTPX library in your Apify Actors.

Introduction
BeautifulSoup is a Python library for extracting data from HTML and XML files. It provides simple methods and Pythonic idioms for navigating, searching, and modifying a website's element tree, enabling efficient data extraction.

HTTPX is a modern, high-level HTTP client library for Python. It provides a simple interface for making HTTP requests and supports both synchronous and asynchronous requests.

To create an Actor which uses those libraries, start from the BeautifulSoup & Python Actor template. This template includes the BeautifulSoup and HTTPX libraries preinstalled, allowing you to begin development immediately.

Example Actor
Below is a simple Actor that recursively scrapes titles from all linked websites, up to a specified maximum depth, starting from URLs provided in the Actor input. It uses HTTPX for fetching pages and BeautifulSoup for parsing their content to extract titles and links to other pages.

Run on
import asyncio
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from apify import Actor, Request


async def main() -> None:
    # Enter the context of the Actor.
    async with Actor:
        # Retrieve the Actor input, and use default values if not provided.
        actor_input = await Actor.get_input() or {}
        start_urls = actor_input.get('start_urls', [{'url': 'https://apify.com'}])
        max_depth = actor_input.get('max_depth', 1)

        # Exit if no start URLs are provided.
        if not start_urls:
            Actor.log.info('No start URLs specified in Actor input, exiting...')
            await Actor.exit()

        # Open the default request queue for handling URLs to be processed.
        request_queue = await Actor.open_request_queue()

        # Enqueue the start URLs with an initial crawl depth of 0.
        for start_url in start_urls:
            url = start_url.get('url')
            Actor.log.info(f'Enqueuing {url} ...')
            new_request = Request.from_url(url, user_data={'depth': 0})
            await request_queue.add_request(new_request)

        # Create an HTTPX client to fetch the HTML content of the URLs.
        async with httpx.AsyncClient() as client:
            # Process the URLs from the request queue.
            while request := await request_queue.fetch_next_request():
                url = request.url

                if not isinstance(request.user_data['depth'], (str, int)):
                    raise TypeError('Request.depth is an unexpected type.')

                depth = int(request.user_data['depth'])
                Actor.log.info(f'Scraping {url} (depth={depth}) ...')

                try:
                    # Fetch the HTTP response from the specified URL using HTTPX.
                    response = await client.get(url, follow_redirects=True)

                    # Parse the HTML content using Beautiful Soup.
                    soup = BeautifulSoup(response.content, 'html.parser')

                    # If the current depth is less than max_depth, find nested links
                    # and enqueue them.
                    if depth < max_depth:
                        for link in soup.find_all('a'):
                            link_href = link.get('href')
                            link_url = urljoin(url, link_href)

                            if link_url.startswith(('http://', 'https://')):
                                Actor.log.info(f'Enqueuing {link_url} ...')
                                new_request = Request.from_url(
                                    link_url,
                                    user_data={'depth': depth + 1},
                                )
                                await request_queue.add_request(new_request)

                    # Extract the desired data.
                    data = {
                        'url': url,
                        'title': soup.title.string if soup.title else None,
                        'h1s': [h1.text for h1 in soup.find_all('h1')],
                        'h2s': [h2.text for h2 in soup.find_all('h2')],
                        'h3s': [h3.text for h3 in soup.find_all('h3')],
                    }

                    # Store the extracted data to the default dataset.
                    await Actor.push_data(data)

                except Exception:
                    Actor.log.exception(f'Cannot extract data from {url}.')

                finally:
                    # Mark the request as handled to ensure it is not processed again.
                    await request_queue.mark_request_as_handled(new_request)


if __name__ == '__main__':
    asyncio.run(main())

Conclusion
In this guide, you learned how to use the BeautifulSoup with the HTTPX in your Apify Actors. By combining these libraries, you can efficiently extract data from HTML or XML files, making it easy to build web scraping tasks in Python. See the Actor templates to get started with your own scraping tasks. If you have questions or need assistance, feel free to reach out on our GitHub or join our Discord community. Happy scraping!