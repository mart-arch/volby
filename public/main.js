const form = document.querySelector('#fetch-form');
const result = document.querySelector('#result');

const renderResult = (content, isError = false) => {
  result.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  pre.className = isError ? 'error' : '';
  result.appendChild(pre);
};

const setLoading = (isLoading) => {
  form.querySelector('button').disabled = isLoading;
  form.querySelector('button').textContent = isLoading ? 'Fetching…' : 'Fetch via Proxy';
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = new FormData(form).get('target-url');
  if (!url) return;

  setLoading(true);
  renderResult('');

  try {
    const response = await fetch(`/api?url=${encodeURIComponent(url)}`);
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Proxy returned ${response.status}: ${errorText}`);
    }

    if (contentType.includes('application/json')) {
      const data = await response.json();
      renderResult(data);
    } else if (contentType.includes('text/')) {
      const text = await response.text();
      renderResult(text);
    } else {
      const blob = await response.blob();
      renderResult(`Received ${contentType} (${blob.size} bytes). Save or process as needed.`);
    }
  } catch (error) {
    console.error(error);
    renderResult(error.message || 'Proxy request failed.', true);
  } finally {
    setLoading(false);
  }
});
