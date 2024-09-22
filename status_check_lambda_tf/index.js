const https = require('https');
const http = require('http');
const url = require('url');

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event));

    // Retrieve URLs from environment variable
    const urlsString = process.env.WEBSITE_URLS;
    if (!urlsString) {
        console.error('No URLs provided in environment variables');
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'No URLs provided in environment variables' })
        };
    }

    // Split the URL string, trim whitespace, and filter out empty entries
    const urls = urlsString.split(',').map(url => url.trim()).filter(url => url.length > 0);

    if (urls.length === 0) {
        console.error('No valid URLs found after processing environment variable');
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'No valid URLs found' })
        };
    }

    console.log(`Found ${urls.length} URLs to check:`, urls);

    try {
        // Check all URLs concurrently
        const results = await Promise.all(urls.map(checkUrl));
        console.log('All URL checks completed');
        return {
            statusCode: 200,
            body: JSON.stringify(results)
        };
    } catch (error) {
        console.error('Unexpected error during URL checks:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error', error: error.message })
        };
    }
};

const checkUrl = async (websiteUrl) => {
    console.log(`Starting check for URL: ${websiteUrl}`);

    // Add https:// prefix if no protocol is specified
    if (!websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
        websiteUrl = 'https://' + websiteUrl;
        console.log(`Added https:// prefix. New URL: ${websiteUrl}`);
    }

    let redirectCount = 0;
    const MAX_REDIRECTS = 5;

    const checkSingleUrl = (urlToCheck) => new Promise((resolve, reject) => {
        const parsedUrl = url.parse(urlToCheck);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        // Make the HTTP/HTTPS request
        const req = protocol.get(urlToCheck, { timeout: 10000 }, (res) => {
            console.log(`${urlToCheck} - Status Code: ${res.statusCode}`);

            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                redirectCount++;
                if (redirectCount > MAX_REDIRECTS) {
                    console.error(`${urlToCheck} - Max redirects reached for this URL`); //replaced console.warn with console.error
                    resolve({
                        url: websiteUrl,
                        status: 'error',
                        message: 'Too many redirects',
                        httpStatus: res.statusCode
                    });
                } else {
                    console.log(`${urlToCheck} - Redirecting to: ${res.headers.location}`);
                    resolve(checkSingleUrl(new URL(res.headers.location, urlToCheck).toString()));
                }
            } else {
                // Consume response data to free up memory
                res.on('data', () => {});
                res.on('end', () => {
                    console.log(`${urlToCheck} - Response ended`);
                    let status, message;

                    // Determine website status based on HTTP status code
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        status = 'Online';
                        message = `Website is up. Status code: ${res.statusCode}`;
                    } else {
                        status = 'Down';
                        message = `Website might be down. Status code: ${res.statusCode}`;
                    }

                    resolve({
                        url: websiteUrl,
                        finalUrl: urlToCheck,
                        status: status,
                        message: message,
                        httpStatus: res.statusCode,
                        redirectCount: redirectCount
                    });
                });
            }
        });

        // Handle request errors
        req.on('error', (error) => {
            console.error(`${urlToCheck} - Error Occured:`, error);
            //console.error("Eror logged is\n",error);
            resolve({
                url: websiteUrl,
                status: 'error',
                message: `Error details are: ${error.message}`,
                error: error.toString()
            });
        });

        // Handle request timeouts
        req.on('timeout', () => {
            console.error(`${urlToCheck} - Request timed out`);
            req.destroy();
            resolve({
                url: websiteUrl,
                status: 'error',
                message: 'Request timed out'
            });
        });

        req.end();
    });

    try {
        return await checkSingleUrl(websiteUrl);
    } catch (error) {
        console.error(`${websiteUrl} - Unexpected error:`, error);
        return {
            url: websiteUrl,
            status: 'error',
            message: `Unexpected error occurred: ${error.message}`,
            error: error.toString()
        };
    }
};
