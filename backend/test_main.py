import asyncio
import os
import unittest
from unittest.mock import patch

from main import BuildSession, apply_edit, focus_target, inspect_html

HTML = '<!doctype html><html><head><title>Café</title><meta name="viewport" content="width=device-width"><style></style></head><body><header id="hero"><h1>Café</h1></header><main><section id="menu"><p>Menu</p></section></main></body></html>'


class HtmlToolsTests(unittest.TestCase):
    def test_edit_changes_only_requested_part(self):
        result = apply_edit(HTML, '<p>Menu</p>', '<p>Menu especial</p>')
        self.assertIn('<p>Menu especial</p>', result)
        self.assertIn('<header id="hero"><h1>Café</h1></header>', result)
        self.assertEqual(focus_target(HTML, '<p>Menu</p>', 'Dados'), {'id': 'menu', 'tag': 'section'})

    def test_rejects_ambiguous_or_destructive_edits(self):
        for old, new in [('', 'x'), ('Não existe', ''), ('</html>', ''), ('Café', 'Texto')]:
            with self.subTest(old=old), self.assertRaises(ValueError):
                apply_edit(HTML, old, new)

    def test_validation_reports_actual_missing_features(self):
        self.assertEqual(inspect_html(HTML)['warnings'], [])
        result = inspect_html('<html><body><img src="x"><a href="">link</a></body></html>')
        self.assertTrue(any('viewport' in warning for warning in result['warnings']))
        self.assertTrue(any('alt' in warning for warning in result['warnings']))
        self.assertTrue(any('link' in warning for warning in result['warnings']))


class FakeSocket:
    def __init__(self):
        self.events = []

    async def send_json(self, data):
        self.events.append(data)


class BuildControlTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.socket = FakeSocket()
        self.session = BuildSession(self.socket)
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def blocked_build(self):
        self.started.set()
        try:
            await asyncio.Event().wait()
        finally:
            self.cancelled.set()

    async def test_pause_cancels_work_and_resume_preserves_completed_steps(self):
        self.session.run = self.blocked_build
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-only'}):
            await self.session.control({'type': 'build', 'prompt': 'Café'})
        await self.started.wait()
        self.session.html, self.session.index = HTML, 3
        await self.session.control({'type': 'pause'})
        self.assertTrue(self.cancelled.is_set())
        self.assertIsNone(self.session.task)
        self.assertEqual(self.session.status, 'paused')
        self.assertEqual(self.session.html, HTML)
        self.started.clear()
        await self.session.control({'type': 'resume'})
        await self.started.wait()
        self.assertEqual(self.session.index, 3)
        self.assertEqual(self.session.html, HTML)
        await self.session.control({'type': 'stop'})
        self.assertEqual(self.session.status, 'stopped')
        self.assertIsNone(self.session.task)
        self.assertEqual([event['state'] for event in self.socket.events if event['type'] == 'state'], ['building', 'paused', 'building', 'stopped'])

    async def test_disconnect_cancels_background_work(self):
        self.session.task = asyncio.create_task(self.blocked_build())
        await self.started.wait()
        await self.session.cancel()
        self.assertTrue(self.cancelled.is_set())

    async def test_failure_never_emits_success(self):
        with patch('main.anthropic.AsyncAnthropic') as client:
            client.return_value.__aenter__.side_effect = ValueError('Falha controlada')
            await self.session.run()
        self.assertEqual(self.session.status, 'error')
        self.assertFalse(any(event['type'] == 'complete' for event in self.socket.events))
        self.assertEqual(self.socket.events[-1]['message'], 'Falha controlada')


if __name__ == '__main__':
    unittest.main()
