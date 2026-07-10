/*
 * Wires the server table's search box and status filter. The table is
 * rendered by templates/servers.liquid after the app mounts, so hooking
 * is retried whenever the DOM changes.
 */
(function () {
    function apply() {
        var search = document.getElementById('cl-search');
        var filter = document.getElementById('cl-filter');

        if (!search) {
            return;
        }

        var query = (search.value || '').toLowerCase();
        var status = filter ? filter.value : '';
        var visible = 0;

        document.querySelectorAll('.cl-row').forEach(function (row) {
            var matches =
                (!query || row.getAttribute('data-name').indexOf(query) !== -1) &&
                (!status || row.getAttribute('data-status') === status);

            row.style.display = matches ? '' : 'none';
            if (matches) {
                visible++;
            }
        });

        var count = document.getElementById('cl-count');

        if (count) {
            count.textContent =
                'Showing ' + visible + ' server' + (visible === 1 ? '' : 's');
        }
    }

    function hook() {
        var search = document.getElementById('cl-search');

        if (!search || search.__hooked) {
            return;
        }

        search.__hooked = true;
        search.addEventListener('input', apply);

        var filter = document.getElementById('cl-filter');

        if (filter) {
            filter.addEventListener('change', apply);
        }
    }

    /*
     * Persistent section tabs on server pages, built from the sidebar's
     * section nav so they exist on every section — not just the overview.
     */
    function syncTabs() {
        var nav = document.getElementById('cl-tabs-persist');

        if (!/\/servers\/[^/]+/.test(window.location.pathname)) {
            if (nav) {
                nav.remove();
            }

            return;
        }

        var links = document.querySelectorAll(
            "[data-slot='sidebar'] a[href^='#']",
        );
        var main = document.querySelector('main');

        if (!links.length || !main) {
            return;
        }

        var html = '';

        links.forEach(function (link) {
            var hash = link.getAttribute('href');
            var label =
                hash === '#home' ? 'Overview' : (link.textContent || '').trim();

            if (label) {
                html +=
                    '<a class="cl-tab" href="' + hash + '">' + label + '</a>';
            }
        });

        // Anchor: after the WHOLE header block — back link plus the hero
        // row that holds the title on the left and power buttons on the
        // right — so nothing inside that row gets displaced.
        var title = main.querySelector('h1');
        var heroRow = title && title.closest('.justify-between');
        var header = heroRow && heroRow.parentElement;

        if (!header) {
            return;
        }

        if (!nav || nav.previousElementSibling !== header) {
            if (nav) {
                nav.remove();
            }

            nav = document.createElement('nav');
            nav.id = 'cl-tabs-persist';
            nav.className = 'cl-tabs';
            nav.__built = undefined;
            header.insertAdjacentElement('afterend', nav);
        }

        if (nav.__built !== html) {
            nav.__built = html;
            nav.innerHTML = html;
        }

        var active = window.location.hash || '#home';

        nav.querySelectorAll('a').forEach(function (tab) {
            tab.classList.toggle(
                'cl-tab-active',
                tab.getAttribute('href') === active,
            );
        });
    }

    window.addEventListener('hashchange', syncTabs);

    /*
     * Console header filters (View All / Errors / Warnings / Info) with
     * live counts, filtering the engine's own console lines.
     */
    var consoleFilter = 'all';

    function lineLevel(text) {
        if (/error|severe/i.test(text)) {
            return 'error';
        }

        if (/warn/i.test(text)) {
            return 'warn';
        }

        if (/info/i.test(text)) {
            return 'info';
        }

        return 'other';
    }

    function decorateConsole() {
        var body = document.querySelector("main div[class*='bg-[#0b0c10]']");

        if (!body) {
            return;
        }

        var toolbar = body.parentElement.firstElementChild;
        var bar = body.parentElement.querySelector('.cl-console-filters');

        if (!bar && toolbar) {
            bar = document.createElement('div');
            bar.className = 'cl-console-filters';
            [
                ['all', 'View All'],
                ['error', 'Errors'],
                ['warn', 'Warnings'],
                ['info', 'Info'],
            ].forEach(function (pair) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('data-console-filter', pair[0]);
                btn.textContent = pair[1] + ' ';
                var count = document.createElement('i');
                count.textContent = '0';
                btn.appendChild(count);
                bar.appendChild(btn);
            });
            toolbar.insertBefore(bar, toolbar.firstChild);
        }

        if (!bar) {
            return;
        }

        var counts = { all: 0, error: 0, warn: 0, info: 0 };

        body.querySelectorAll('p').forEach(function (line) {
            var level = lineLevel(line.textContent || '');
            counts.all++;

            if (counts[level] !== undefined) {
                counts[level]++;
            }

            line.style.display =
                consoleFilter === 'all' || level === consoleFilter
                    ? ''
                    : 'none';
        });

        bar.querySelectorAll('button').forEach(function (btn) {
            var key = btn.getAttribute('data-console-filter');
            var count = btn.querySelector('i');
            var next = String(counts[key] !== undefined ? counts[key] : 0);

            // Only write on change — the MutationObserver that re-runs this
            // watches childList, and textContent writes count as mutations.
            if (count.textContent !== next) {
                count.textContent = next;
            }

            btn.classList.toggle('cl-cf-active', key === consoleFilter);
        });
    }

    document.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-console-filter]');

        if (!btn) {
            return;
        }

        consoleFilter = btn.getAttribute('data-console-filter');
        decorateConsole();
    });

    function pinConsoles() {
        document
            .querySelectorAll('[data-console-scroll]')
            .forEach(function (box) {
                box.scrollTop = box.scrollHeight;
            });
    }

    /*
     * Graft the template's extra chips into the engine hero's chip row,
     * re-synced whenever the template re-renders with fresh live data.
     */
    function syncHeroChips() {
        var source = document.querySelector('[data-hero-chips]');
        var holder = document.getElementById('cl-hero-extra');

        if (!source) {
            if (holder) {
                holder.remove();
            }

            return;
        }

        var row = document.querySelector('.flex.flex-wrap.items-center.gap-2');

        if (!row) {
            return;
        }

        if (!holder || !row.contains(holder)) {
            holder = document.createElement('span');
            holder.id = 'cl-hero-extra';
            holder.style.display = 'contents';
            row.appendChild(holder);
        }

        if (holder.innerHTML !== source.innerHTML) {
            holder.innerHTML = source.innerHTML;
        }
    }

    hook();
    pinConsoles();
    syncHeroChips();
    syncTabs();
    decorateConsole();
    new MutationObserver(function () {
        hook();
        pinConsoles();
        syncHeroChips();
        syncTabs();
        decorateConsole();
    }).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    /*
     * Row actions: copy-to-clipboard, and rename by delegating to the
     * engine's own rename control up in the hero.
     */
    document.addEventListener('click', function (event) {
        var action = event.target.closest('[data-action]');

        if (!action) {
            return;
        }

        if (action.getAttribute('data-action') === 'copy') {
            navigator.clipboard
                .writeText(action.getAttribute('data-copy') || '')
                .then(function () {
                    action.classList.add('cl-copied');
                    setTimeout(function () {
                        action.classList.remove('cl-copied');
                    }, 1200);
                });
        }

        if (action.getAttribute('data-action') === 'rename') {
            var rename = document.querySelector('[aria-label="Rename server"]');

            if (rename) {
                rename.click();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }
    });

    /*
     * Power bridge: any template button with data-power="start|restart|stop"
     * drives the real power endpoint for the server being viewed.
     */
    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-power]');

        if (!button) {
            return;
        }

        event.preventDefault();

        var match = window.location.pathname.match(/\/servers\/([^/]+)/);

        if (!match) {
            return;
        }

        var hint = document.querySelector('[data-power-hint]');
        var xsrf = document.cookie.match(/XSRF-TOKEN=([^;]+)/);

        button.disabled = true;

        fetch('/servers/' + match[1] + '/power', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-XSRF-TOKEN': decodeURIComponent(xsrf ? xsrf[1] : ''),
            },
            body: JSON.stringify({ action: button.getAttribute('data-power') }),
        })
            .then(function (response) {
                return response.ok
                    ? { ok: true }
                    : response.json().then(function (body) {
                          return { ok: false, body: body };
                      });
            })
            .then(function (result) {
                button.disabled = false;

                if (!hint) {
                    return;
                }

                hint.classList.remove('cl-hint-ok', 'cl-hint-err');

                if (result.ok) {
                    hint.classList.add('cl-hint-ok');
                    hint.textContent =
                        button.getAttribute('data-power') +
                        ' sent — the server responds within seconds.';
                } else {
                    hint.classList.add('cl-hint-err');
                    hint.textContent =
                        (result.body &&
                            result.body.errors &&
                            result.body.errors.action &&
                            result.body.errors.action[0]) ||
                        (result.body && result.body.message) ||
                        'That did not go through — try again.';
                }
            });
    });
})();
